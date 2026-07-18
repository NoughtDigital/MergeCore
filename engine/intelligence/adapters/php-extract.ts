import * as fs from 'fs';
import * as path from 'path';
import type {
  AdapterDiagnostic,
  DependencyEdge,
  LanguageProjectHint,
  SymbolParameter,
  SymbolRecord,
} from '../contracts';
import { sha256 } from '../rag/hash';

function normalisePath(p: string): string {
  return p.replace(/\\/g, '/');
}

function findBlockEnd(lines: readonly string[], start: number): number {
  let depth = 0;
  let seenBrace = false;
  for (let i = start; i < lines.length; i++) {
    const line = lines[i] ?? '';
    for (const ch of line) {
      if (ch === '{') {
        depth++;
        seenBrace = true;
      } else if (ch === '}') {
        depth--;
        if (seenBrace && depth <= 0) {
          return i;
        }
      }
    }
    if (!seenBrace && /;\s*$/.test(line) && i > start) {
      return i;
    }
  }
  return Math.min(lines.length - 1, start + 80);
}

function edgeId(parts: readonly string[]): string {
  return sha256(parts.join('|')).slice(0, 24);
}

/** PSR-4 / Laravel-style FQCN → relative path guess. */
export function resolvePhpFqcnToPath(
  fqcn: string,
  namespaceMap: ReadonlyMap<string, string>
): string | undefined {
  const cleaned = fqcn.replace(/^\\/, '').replace(/::class$/, '');
  if (!cleaned) {
    return undefined;
  }
  let bestPrefix = '';
  let bestDir = '';
  for (const [prefix, dir] of namespaceMap) {
    if (cleaned === prefix || cleaned.startsWith(prefix + '\\')) {
      if (prefix.length >= bestPrefix.length) {
        bestPrefix = prefix;
        bestDir = dir;
      }
    }
  }
  if (!bestPrefix) {
    // Laravel default
    if (cleaned.startsWith('App\\')) {
      bestPrefix = 'App';
      bestDir = 'app/';
    } else {
      return undefined;
    }
  }
  const rest = cleaned.slice(bestPrefix.length).replace(/^\\/, '');
  const rel = normalisePath(
    path.posix.join(bestDir.replace(/\\/g, '/').replace(/\/?$/, '/'), rest.replace(/\\/g, '/')) +
      '.php'
  );
  return rel.replace(/^\.\//, '');
}

export function loadComposerPsr4Map(workspaceRoot: string | undefined): Map<string, string> {
  const map = new Map<string, string>();
  map.set('App', 'app');
  if (!workspaceRoot) {
    return map;
  }
  try {
    const raw = fs.readFileSync(path.join(workspaceRoot, 'composer.json'), 'utf8');
    const json = JSON.parse(raw) as {
      autoload?: { 'psr-4'?: Record<string, string | string[]> };
      'autoload-dev'?: { 'psr-4'?: Record<string, string | string[]> };
    };
    const apply = (psr4: Record<string, string | string[]> | undefined): void => {
      if (!psr4) return;
      for (const [ns, dirs] of Object.entries(psr4)) {
        const prefix = ns.replace(/\\$/, '');
        const dirList = Array.isArray(dirs) ? dirs : [dirs];
        const dir = dirList[0];
        if (dir) {
          map.set(prefix, dir.replace(/\\/g, '/').replace(/\/?$/, ''));
        }
      }
    };
    apply(json.autoload?.['psr-4']);
    apply(json['autoload-dev']?.['psr-4']);
  } catch {
    // keep App → app default
  }
  return map;
}

function parsePhpDocSummary(lines: readonly string[], declLine: number): string | undefined {
  for (let i = declLine - 1; i >= Math.max(0, declLine - 12); i--) {
    const line = lines[i] ?? '';
    if (/^\s*\/\*\*/.test(line) || /^\s*\*/.test(line) || /^\s*\*\//.test(line)) {
      continue;
    }
    if (i < declLine - 1) {
      break;
    }
  }
  let start = -1;
  for (let i = declLine - 1; i >= Math.max(0, declLine - 20); i--) {
    if (/^\s*\/\*\*/.test(lines[i] ?? '')) {
      start = i;
      break;
    }
    if ((lines[i] ?? '').trim() !== '' && !/^\s*\*/.test(lines[i] ?? '')) {
      break;
    }
  }
  if (start < 0) {
    return undefined;
  }
  const bits: string[] = [];
  for (let i = start; i < declLine; i++) {
    const m = (lines[i] ?? '').match(/^\s*\/?\*+\s?(.*?)(?:\*\/)?$/);
    if (!m) continue;
    const text = (m[1] ?? '').trim();
    if (!text || text.startsWith('@')) continue;
    bits.push(text);
    if (bits.length >= 2) break;
  }
  return bits.length > 0 ? bits.join(' ') : undefined;
}

function parseConstructorParams(sig: string): SymbolParameter[] {
  const open = sig.indexOf('(');
  const close = sig.lastIndexOf(')');
  if (open < 0 || close <= open) {
    return [];
  }
  const inner = sig.slice(open + 1, close).trim();
  if (!inner) {
    return [];
  }
  const parts = splitPhpArgs(inner);
  const out: SymbolParameter[] = [];
  for (const part of parts) {
    const cleaned = part.trim();
    if (!cleaned) continue;
    const optional = cleaned.includes('=');
    const rest = /\.\.\./.test(cleaned);
    const m = cleaned.match(
      /(?:(?:public|protected|private|readonly)\s+)*(?:(\??[\w\\]+)\s+)?(?:&)?(?:\.\.\.)?\$([A-Za-z_][\w]*)/
    );
    if (!m) continue;
    out.push({
      name: m[2]!,
      ...(m[1] ? { typeText: m[1].replace(/^\?/, '') } : {}),
      ...(optional ? { optional: true } : {}),
      ...(rest ? { rest: true } : {}),
    });
  }
  return out;
}

function splitPhpArgs(inner: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = '';
  for (const ch of inner) {
    if (ch === '(' || ch === '<' || ch === '[') depth++;
    if (ch === ')' || ch === '>' || ch === ']') depth = Math.max(0, depth - 1);
    if (ch === ',' && depth === 0) {
      parts.push(current);
      current = '';
      continue;
    }
    current += ch;
  }
  if (current.trim()) parts.push(current);
  return parts;
}

function inferPhpRole(
  filePath: string,
  kind: string,
  name: string,
  extendsName?: string,
  implementsList: readonly string[] = []
): string | undefined {
  const p = normalisePath(filePath).toLowerCase();
  if (p.includes('/http/controllers/') || name.endsWith('Controller')) return 'controller';
  if (p.includes('/models/') || extendsName === 'Model' || extendsName?.endsWith('\\Model')) {
    return 'model';
  }
  if (p.includes('/policies/') || name.endsWith('Policy')) return 'policy';
  if (p.includes('/jobs/') || implementsList.some((i) => i.includes('ShouldQueue'))) return 'job';
  if (p.includes('/events/') || name.endsWith('Event')) return 'event';
  if (p.includes('/listeners/') || name.endsWith('Listener')) return 'listener';
  if (p.includes('/console/commands/') || extendsName === 'Command' || name.endsWith('Command')) {
    return 'command';
  }
  if (p.includes('/database/migrations/') || /^[0-9].*_/.test(path.basename(filePath))) {
    if (p.includes('migration') || /Schema::/.test(name)) return 'migration';
  }
  if (p.includes('/routes/')) return 'route-file';
  if (kind === 'interface') return 'interface';
  if (kind === 'trait') return 'trait';
  if (kind === 'enum') return 'enum';
  return undefined;
}

export interface PhpExtractContext {
  readonly workspaceRoot?: string;
  readonly namespaceMap?: ReadonlyMap<string, string>;
  readonly adapterId?: string;
}

/**
 * Heuristic PHP symbol extraction (classes, interfaces, traits, enums,
 * functions, methods, namespaces). Not a full PHP parser.
 */
export function extractPhpSymbols(
  filePath: string,
  content: string,
  ctx: PhpExtractContext = {}
): SymbolRecord[] {
  const adapterId = ctx.adapterId ?? 'php';
  const rel = normalisePath(filePath);
  const lines = content.split(/\r?\n/);
  const out: SymbolRecord[] = [];
  let namespace = '';
  let typeName: string | undefined;
  let typeKind: string | undefined;
  let typeStart = 0;
  let extendsName: string | undefined;
  let implementsList: string[] = [];

  const flushType = (endLine: number): void => {
    if (!typeName || !typeKind) return;
    const role = inferPhpRole(rel, typeKind, typeName, extendsName, implementsList);
    out.push({
      id: `php:${rel}:${typeName}:${typeStart}`,
      name: typeName,
      kind: typeKind,
      location: { path: rel, startLine: typeStart, endLine: endLine },
      language: 'php',
      adapterId,
      exported: true,
      containerName: namespace || undefined,
      signatureText: role
        ? `${typeKind} ${namespace ? namespace + '\\' : ''}${typeName} (${role})`
        : `${typeKind} ${namespace ? namespace + '\\' : ''}${typeName}`,
      jsdocSummary: parsePhpDocSummary(lines, typeStart - 1),
    });
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? '';

    const nsMatch = line.match(/^\s*namespace\s+([\w\\]+)\s*;/);
    if (nsMatch) {
      namespace = nsMatch[1] ?? '';
      out.push({
        id: `php:${rel}:namespace:${namespace}:${i + 1}`,
        name: namespace,
        kind: 'namespace',
        location: { path: rel, startLine: i + 1, endLine: i + 1 },
        language: 'php',
        adapterId,
        exported: true,
      });
      continue;
    }

    const typeMatch = line.match(
      /^\s*(?:abstract\s+|final\s+|readonly\s+)*(class|interface|trait|enum)\s+([A-Za-z_][\w]*)/
    );
    if (typeMatch) {
      if (typeName) {
        flushType(i);
      }
      typeKind = typeMatch[1];
      typeName = typeMatch[2];
      typeStart = i + 1;
      extendsName = line.match(/\bextends\s+([\\\\\w]+)/)?.[1];
      const impl = line.match(/\bimplements\s+(.+?)(?:\{|$)/)?.[1];
      implementsList = impl
        ? impl.split(',').map((s) => s.trim()).filter(Boolean)
        : [];
      // Look ahead one line for implements split across lines
      if (!impl && i + 1 < lines.length) {
        const next = lines[i + 1] ?? '';
        const impl2 = next.match(/^\s*implements\s+(.+?)(?:\{|$)/)?.[1];
        if (impl2) {
          implementsList = impl2.split(',').map((s) => s.trim()).filter(Boolean);
        }
      }
      continue;
    }

    const methodMatch = line.match(
      /^\s*(?:public|protected|private|final|static|\s)*\s*function\s+&?([A-Za-z_][\w]*)\s*\(/
    );
    if (methodMatch) {
      const name = methodMatch[1]!;
      const end = findBlockEnd(lines, i);
      const block = lines.slice(i, end + 1).join('\n');
      const params = name === '__construct' ? parseConstructorParams(block) : parseConstructorParams(line + (lines[i + 1] ?? ''));
      const returnMatch = line.match(/\)\s*:\s*(\??[\w\\|]+)/);
      out.push({
        id: `php:${rel}:${typeName ? `${typeName}::${name}` : name}:${i + 1}`,
        name,
        kind: typeName ? (name === '__construct' ? 'constructor' : 'method') : 'function',
        location: { path: rel, startLine: i + 1, endLine: end + 1 },
        language: 'php',
        adapterId,
        exported: true,
        containerName: typeName ?? (namespace || undefined),
        parameters: params.length > 0 ? params : undefined,
        returnTypeText: returnMatch?.[1],
        signatureText: line.trim().replace(/\s+/g, ' ').slice(0, 200),
        jsdocSummary: parsePhpDocSummary(lines, i),
      });
    }
  }

  if (typeName) {
    flushType(lines.length);
  }

  return out;
}

/**
 * use imports, require/include, and Laravel route → controller edges.
 * Framework / container resolution is always heuristic.
 */
export function extractPhpDependencies(
  filePath: string,
  content: string,
  ctx: PhpExtractContext = {}
): DependencyEdge[] {
  const rel = normalisePath(filePath);
  const lines = content.split(/\r?\n/);
  const nsMap = ctx.namespaceMap ?? loadComposerPsr4Map(ctx.workspaceRoot);
  const edges: DependencyEdge[] = [];
  const aliases = new Map<string, string>(); // short → FQCN

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? '';

    const useMatch = line.match(
      /^\s*use\s+([\w\\]+)(?:\s+as\s+([A-Za-z_][\w]*))?\s*;/
    );
    if (useMatch) {
      const fqcn = useMatch[1]!;
      const alias = useMatch[2] ?? fqcn.split('\\').pop()!;
      aliases.set(alias, fqcn);
      const toPath = resolvePhpFqcnToPath(fqcn, nsMap) ?? '';
      edges.push({
        id: edgeId(['import', rel, fqcn, String(i + 1)]),
        fromPath: rel,
        toPath,
        kind: 'import',
        specifier: fqcn,
        startLine: i + 1,
        endLine: i + 1,
        confidence: toPath ? 'medium' : 'low',
        resolutionMethod: toPath ? 'convention' : 'unresolved',
        evidence: ['php-use-statement'],
      });
      continue;
    }

    const requireMatch = line.match(
      /^\s*(?:require|require_once|include|include_once)\s*\(?\s*['"]([^'"]+)['"]/
    );
    if (requireMatch) {
      const spec = requireMatch[1]!;
      edges.push({
        id: edgeId(['require', rel, spec, String(i + 1)]),
        fromPath: rel,
        toPath: normalisePath(spec),
        kind: 'require',
        specifier: spec,
        startLine: i + 1,
        endLine: i + 1,
        confidence: 'heuristic',
        resolutionMethod: 'heuristic',
        evidence: ['php-require'],
      });
    }

    // Route::get/post/...('path', [Controller::class, 'method'])
    const routeMatch = line.match(
      /Route::(get|post|put|patch|delete|options|any|match)\s*\(\s*['"]([^'"]+)['"]/
    );
    if (routeMatch) {
      const method = routeMatch[1]!;
      const routePath = routeMatch[2]!;
      let controller = '';
      let action = '';
      const arrayForm = content
        .slice(content.indexOf(line))
        .match(
          /\[[\s\n]*([\\\\\w]+)::class\s*,\s*['"]([A-Za-z_][\w]*)['"]\s*\]/
        );
      if (arrayForm) {
        controller = arrayForm[1]!;
        action = arrayForm[2]!;
      } else {
        const atForm = line.match(/['"]([\w\\]+)@([A-Za-z_][\w]*)['"]/);
        if (atForm) {
          controller = atForm[1]!;
          action = atForm[2]!;
        }
      }
      const fqcn =
        controller.includes('\\') || controller === ''
          ? controller
          : aliases.get(controller) ?? `App\\Http\\Controllers\\${controller}`;
      const toPath = fqcn ? resolvePhpFqcnToPath(fqcn, nsMap) ?? '' : '';
      edges.push({
        id: edgeId(['route', rel, method, routePath, String(i + 1)]),
        fromPath: rel,
        toPath,
        kind: 'reference',
        specifier: `route:${method.toUpperCase()} ${routePath}`,
        fromSymbol: undefined,
        toSymbol: action || undefined,
        startLine: i + 1,
        endLine: i + 1,
        confidence: 'heuristic',
        resolutionMethod: 'convention',
        evidence: ['laravel-route', 'framework-convention'],
      });
    }
  }

  // Heuristic container bind / make — never certain
  if (/\bapp\((['"])([^'"]+)\1\)/.test(content) || /\bresolve\((['"])([^'"]+)\1\)/.test(content)) {
    const bindRe = /\b(?:app|resolve)\((['"])([^'"]+)\1\)/g;
    let m: RegExpExecArray | null;
    while ((m = bindRe.exec(content)) !== null) {
      const spec = m[2]!;
      const lineNo = content.slice(0, m.index).split(/\r?\n/).length;
      edges.push({
        id: edgeId(['container', rel, spec, String(lineNo)]),
        fromPath: rel,
        toPath: resolvePhpFqcnToPath(spec, nsMap) ?? '',
        kind: 'reference',
        specifier: `container:${spec}`,
        startLine: lineNo,
        endLine: lineNo,
        confidence: 'heuristic',
        resolutionMethod: 'heuristic',
        evidence: ['laravel-container-runtime', 'not-compiler-certain'],
      });
    }
  }

  return edges;
}

export function extractPhpTypeRelationships(
  filePath: string,
  content: string,
  ctx: PhpExtractContext = {}
): DependencyEdge[] {
  const rel = normalisePath(filePath);
  const lines = content.split(/\r?\n/);
  const nsMap = ctx.namespaceMap ?? loadComposerPsr4Map(ctx.workspaceRoot);
  const edges: DependencyEdge[] = [];
  let currentClass: string | undefined;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? '';
    const typeMatch = line.match(
      /^\s*(?:abstract\s+|final\s+|readonly\s+)*(class|interface|trait|enum)\s+([A-Za-z_][\w]*)/
    );
    if (typeMatch) {
      currentClass = typeMatch[2];
      const extendsMatch = line.match(/\bextends\s+([\\\\\w]+)/);
      if (extendsMatch && currentClass) {
        const parent = extendsMatch[1]!;
        edges.push({
          id: edgeId(['extends', rel, currentClass, parent]),
          fromPath: rel,
          toPath: resolvePhpFqcnToPath(parent, nsMap) ?? '',
          kind: 'extends',
          specifier: parent,
          fromSymbol: currentClass,
          toSymbol: parent.split('\\').pop(),
          startLine: i + 1,
          endLine: i + 1,
          confidence: 'high',
          resolutionMethod: 'ast',
          evidence: ['php-extends'],
        });
      }
      const implMatch = line.match(/\bimplements\s+(.+?)(?:\{|$)/);
      const implText =
        implMatch?.[1] ??
        (lines[i + 1] ?? '').match(/^\s*implements\s+(.+?)(?:\{|$)/)?.[1];
      if (implText && currentClass) {
        for (const iface of implText.split(',').map((s) => s.trim()).filter(Boolean)) {
          edges.push({
            id: edgeId(['implements', rel, currentClass, iface]),
            fromPath: rel,
            toPath: resolvePhpFqcnToPath(iface, nsMap) ?? '',
            kind: 'implements',
            specifier: iface,
            fromSymbol: currentClass,
            toSymbol: iface.split('\\').pop(),
            startLine: i + 1,
            endLine: i + 1,
            confidence: 'high',
            resolutionMethod: 'ast',
            evidence: ['php-implements'],
          });
        }
      }
      continue;
    }

    // trait use inside class body: use SomeTrait;
    if (currentClass) {
      const traitUse = line.match(/^\s*use\s+([A-Za-z_][\w\\]*)\s*;/);
      if (traitUse && !line.includes('{')) {
        // Distinguish from file-level use by indentation / being after class
        const trait = traitUse[1]!;
        if (!/^\s*use\s+[\w\\]+(?:\s+as\s+)/.test(line) && line.trim().startsWith('use ')) {
          // File-level use already handled; trait use is typically indented
          if (/^\s{2,}/.test(line) || /^\t/.test(line)) {
            edges.push({
              id: edgeId(['trait', rel, currentClass, trait]),
              fromPath: rel,
              toPath: resolvePhpFqcnToPath(trait, nsMap) ?? '',
              kind: 'typeUsage',
              specifier: `trait:${trait}`,
              fromSymbol: currentClass,
              toSymbol: trait.split('\\').pop(),
              startLine: i + 1,
              endLine: i + 1,
              confidence: 'high',
              resolutionMethod: 'ast',
              evidence: ['php-trait-use'],
            });
          }
        }
      }
    }

    // Constructor injection type usage
    if (/function\s+__construct\s*\(/.test(line)) {
      const end = findBlockEnd(lines, i);
      const block = lines.slice(i, Math.min(end, i + 5) + 1).join(' ');
      const params = parseConstructorParams(block);
      for (const p of params) {
        if (!p.typeText || /^(string|int|float|bool|array|callable|iterable|mixed|object)$/i.test(p.typeText)) {
          continue;
        }
        edges.push({
          id: edgeId(['ctor', rel, p.typeText, p.name]),
          fromPath: rel,
          toPath: resolvePhpFqcnToPath(p.typeText, nsMap) ?? '',
          kind: 'typeUsage',
          specifier: p.typeText,
          fromSymbol: currentClass ? `${currentClass}::__construct` : '__construct',
          toSymbol: p.typeText.split('\\').pop(),
          startLine: i + 1,
          endLine: i + 1,
          confidence: 'high',
          resolutionMethod: 'ast',
          evidence: ['constructor-injection'],
        });
      }
    }
  }

  return edges;
}

/**
 * Same-file method call references (heuristic). Cross-file call resolution
 * is not compiler-certain without a PHP language server.
 */
export function extractPhpCallersOrReferences(
  filePath: string,
  content: string,
  ctx: PhpExtractContext = {}
): DependencyEdge[] {
  const adapterId = ctx.adapterId ?? 'php';
  void adapterId;
  const rel = normalisePath(filePath);
  const lines = content.split(/\r?\n/);
  const edges: DependencyEdge[] = [];
  let currentMethod: string | undefined;
  let currentClass: string | undefined;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? '';
    const classMatch = line.match(
      /^\s*(?:abstract\s+|final\s+|readonly\s+)*class\s+([A-Za-z_][\w]*)/
    );
    if (classMatch) {
      currentClass = classMatch[1];
    }
    const methodMatch = line.match(
      /^\s*(?:public|protected|private|final|static|\s)*\s*function\s+&?([A-Za-z_][\w]*)\s*\(/
    );
    if (methodMatch) {
      currentMethod = currentClass
        ? `${currentClass}::${methodMatch[1]}`
        : methodMatch[1];
    }

    const callMatch = line.matchAll(/\$this->([A-Za-z_][\w]*)\s*\(/g);
    for (const m of callMatch) {
      const callee = m[1]!;
      edges.push({
        id: edgeId(['call', rel, currentMethod ?? '', callee, String(i + 1)]),
        fromPath: rel,
        toPath: rel,
        kind: 'call',
        specifier: callee,
        fromSymbol: currentMethod,
        toSymbol: currentClass ? `${currentClass}::${callee}` : callee,
        startLine: i + 1,
        endLine: i + 1,
        confidence: 'medium',
        resolutionMethod: 'heuristic',
        evidence: ['php-this-call', 'same-file-heuristic'],
      });
    }
  }

  return edges;
}

export function extractPhpTestRelationships(
  filePath: string,
  content: string,
  ctx: PhpExtractContext = {}
): DependencyEdge[] {
  const rel = normalisePath(filePath);
  const nsMap = ctx.namespaceMap ?? loadComposerPsr4Map(ctx.workspaceRoot);
  const edges: DependencyEdge[] = [];
  const isTest =
    /(?:^|\/)tests?\//i.test(rel) ||
    /\b(Test|Pest)\.php$/i.test(rel) ||
    /\btest_/i.test(path.basename(rel));
  if (!isTest) {
    return edges;
  }

  const lines = content.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? '';
    const useMatch = line.match(/^\s*use\s+([\w\\]+)\s*;/);
    if (useMatch) {
      const fqcn = useMatch[1]!;
      const toPath = resolvePhpFqcnToPath(fqcn, nsMap) ?? '';
      if (!toPath || /(?:^|\/)tests?\//i.test(toPath)) continue;
      edges.push({
        id: edgeId(['test', rel, fqcn]),
        fromPath: rel,
        toPath,
        kind: 'likelyTestCoverage',
        specifier: fqcn,
        startLine: i + 1,
        endLine: i + 1,
        confidence: 'heuristic',
        resolutionMethod: 'convention',
        evidence: content.includes('uses(') || content.includes('test(')
          ? ['pest-test', 'use-import']
          : ['phpunit-test', 'use-import'],
      });
    }
  }

  // Pest describe / test targeting class name in string
  const pestTarget = content.match(/describe\(\s*['"]([^'"]+)['"]/);
  if (pestTarget) {
    const name = pestTarget[1]!;
    const guess = resolvePhpFqcnToPath(
      name.includes('\\') ? name : `App\\${name}`,
      nsMap
    );
    if (guess) {
      edges.push({
        id: edgeId(['pest', rel, name]),
        fromPath: rel,
        toPath: guess,
        kind: 'likelyTestCoverage',
        specifier: name,
        confidence: 'heuristic',
        resolutionMethod: 'convention',
        evidence: ['pest-describe', 'naming-heuristic'],
      });
    }
  }

  return edges;
}

export function extractPhpDiagnostics(
  filePath: string,
  content: string
): AdapterDiagnostic[] {
  const rel = normalisePath(filePath);
  const diagnostics: AdapterDiagnostic[] = [];
  if (!content.includes('<?php') && !content.includes('<?=')) {
    diagnostics.push({
      path: rel,
      startLine: 1,
      endLine: 1,
      severity: 'info',
      code: 'php-missing-open-tag',
      message: 'PHP open tag not found; treating file as PHP by extension only.',
    });
  }
  if (/\bapp\((['"])[^'"]+\1\)/.test(content) || /\bresolve\((['"])[^'"]+\1\)/.test(content)) {
    diagnostics.push({
      path: rel,
      startLine: 1,
      endLine: 1,
      severity: 'info',
      code: 'php-container-runtime',
      message:
        'Service-container resolution detected; edges are heuristic and not compiler-certain.',
    });
  }
  return diagnostics;
}

export function collectPhpInvalidationTargets(
  changedPath: string,
  edges: readonly DependencyEdge[]
): readonly string[] {
  const changed = normalisePath(changedPath);
  const out = new Set<string>();
  for (const e of edges) {
    if (e.toPath === changed && e.fromPath !== changed) {
      out.add(e.fromPath);
    }
    if (e.fromPath === changed && e.toPath && e.toPath !== changed) {
      out.add(e.toPath);
    }
  }
  return [...out];
}

export function detectPhpProject(
  workspaceRoot: string,
  topLevelNames: readonly string[]
): LanguageProjectHint | undefined {
  const names = new Set(topLevelNames.map((n) => n.toLowerCase()));
  const signals: string[] = [];
  const frameworks: string[] = [];
  if (names.has('composer.json')) signals.push('composer.json');
  if (names.has('artisan')) {
    signals.push('artisan');
    frameworks.push('laravel');
  }
  if (names.has('app') && names.has('bootstrap')) {
    signals.push('laravel-layout');
    if (!frameworks.includes('laravel')) frameworks.push('laravel');
  }
  try {
    const raw = fs.readFileSync(path.join(workspaceRoot, 'composer.json'), 'utf8');
    if (/laravel\/framework/.test(raw)) {
      signals.push('laravel/framework');
      if (!frameworks.includes('laravel')) frameworks.push('laravel');
    }
    if (/pestphp\/pest/.test(raw)) {
      signals.push('pestphp/pest');
      frameworks.push('pest');
    }
    if (/phpunit\/phpunit/.test(raw)) {
      signals.push('phpunit/phpunit');
      frameworks.push('phpunit');
    }
  } catch {
    // ignore
  }
  if (signals.length === 0) {
    return undefined;
  }
  return {
    languageId: 'php',
    adapterId: 'php',
    confidence: frameworks.includes('laravel') || names.has('composer.json') ? 'high' : 'medium',
    signals,
    frameworkHints: frameworks.length > 0 ? frameworks : undefined,
  };
}
