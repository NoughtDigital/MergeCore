import * as path from 'path';
import * as vscode from 'vscode';
import type { RelatedContextFile, ReviewRelatedContext, ReviewScope } from '../domain/review-types';
import { resolveInsideWorkspace } from './workspace-path';

const MAX_RELATED_FILES = 16;
const MAX_TOTAL_EXCERPT_CHARS = 24_000;
const MAX_EXCERPT_CHARS = 3_500;
const EXCERPT_RADIUS = 850;
const EXCLUDE_GLOB = '{vendor,node_modules,storage,bootstrap/cache,.git,dist,build,out,coverage}/**';
const SOURCE_EXTENSIONS = [
  '.php',
  '.ts',
  '.tsx',
  '.js',
  '.jsx',
  '.vue',
  '.py',
  '.go',
  '.swift',
  '.rs',
  '.rb',
  '.java',
  '.kt',
  '.cs',
  '.sql',
  '.prisma',
  '.json',
  '.yaml',
  '.yml',
] as const;
const BINARY_EXTENSIONS = new Set([
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.webp',
  '.ico',
  '.pdf',
  '.zip',
  '.gz',
  '.tar',
  '.mp4',
  '.mov',
  '.mp3',
  '.woff',
  '.woff2',
  '.ttf',
  '.otf',
  '.lock',
]);
const ROLE_SUFFIX = /(Controller|Service|Action|Repository|Request|Job|Event|Policy|Observer|Listener|Notification|Rule|Model|Store|Hook|Composable|View|Component|Command|Handler)$/;

interface CollectArgs {
  readonly scope: ReviewScope;
  readonly workspaceRoot: string;
  readonly filePath: string;
  readonly content: string;
}

interface TargetFile {
  readonly relPath: string;
  readonly content: string;
}

interface Candidate {
  readonly relPath: string;
  readonly reason: string;
  readonly terms: readonly string[];
  readonly priority: number;
  readonly kind: 'class' | 'routes' | 'schema' | 'tests' | 'config' | 'file';
}

export async function collectRelatedContext(args: CollectArgs): Promise<ReviewRelatedContext | undefined> {
  const targets = await resolveTargetFiles(args);
  if (targets.length === 0) {
    return undefined;
  }

  const candidates = new Map<string, Candidate>();
  const notes = new Set<string>();

  addWorkspaceManifests(candidates);

  for (const target of targets.slice(0, 6)) {
    const targetContent = target.content;
    const classBase = basenameWithoutExt(target.relPath);
    const domainBase = stripRoleSuffix(classBase);
    const terms = buildTerms(targetContent, classBase, domainBase);

    addImportedFiles(candidates, target, args.workspaceRoot);
    addClassNameFiles(candidates, terms.classNames);
    addRoleConventions(candidates, domainBase, terms.classNames);
    addRouteCandidates(candidates, classBase, domainBase, target.relPath, terms.searchTerms);
    addSchemaCandidates(candidates, tableNamesFor([domainBase, ...terms.classNames]), terms.searchTerms);
    addTests(candidates, classBase, domainBase, terms.searchTerms);
    addConfigFiles(candidates, targetContent);
    collectEnvNotes(notes, targetContent, target.relPath);
  }

  await addClassMatches(candidates, args.workspaceRoot);
  await addContentMatches(candidates, args.workspaceRoot, 'routes');
  await addContentMatches(candidates, args.workspaceRoot, 'schema');
  await addContentMatches(candidates, args.workspaceRoot, 'tests');
  await addContentMatches(candidates, args.workspaceRoot, 'config');
  await addConfigMatches(candidates, args.workspaceRoot, notes);

  const files = await materialiseCandidates(args.workspaceRoot, candidates, targets.map((t) => t.relPath));
  if (files.length === 0 && notes.size === 0) {
    return undefined;
  }

  return {
    strategy: 'pack-agnostic-system-map:v1',
    files,
    notes: [...notes],
    totalExcerptChars: files.reduce((sum, f) => sum + f.excerpt.length, 0),
  };
}

export function formatRelatedContextDigest(context: ReviewRelatedContext | undefined): string | undefined {
  if (!context || (context.files.length === 0 && (context.notes?.length ?? 0) === 0)) {
    return undefined;
  }

  const lines: string[] = [];
  lines.push(`Strategy: ${context.strategy}`);
  lines.push(`Files: ${context.files.length}`);
  lines.push(`Excerpt characters: ${context.totalExcerptChars}`);
  if (context.notes && context.notes.length > 0) {
    lines.push('Notes:');
    for (const note of context.notes) {
      lines.push(`- ${note}`);
    }
  }
  for (const file of context.files) {
    lines.push('');
    lines.push(`File: ${file.path}`);
    lines.push(`Reason: ${file.reason}`);
    lines.push('Excerpt:');
    lines.push(file.excerpt);
    lines.push(`End file: ${file.path}`);
  }
  return lines.join('\n');
}

async function resolveTargetFiles(args: CollectArgs): Promise<TargetFile[]> {
  if (args.scope !== 'git-diff') {
    if (!isCollectablePath(args.filePath)) {
      return [];
    }
    return [{ relPath: toRel(args.workspaceRoot, args.filePath), content: args.content }];
  }

  const rels = [...new Set([...args.content.matchAll(/^diff --git a\/(.+?) b\/(.+)$/gm)]
    .map((m) => m[2])
    .filter(isCollectablePath))];
  const out: TargetFile[] = [];
  for (const rel of rels.slice(0, 8)) {
    const content = await readUtf8(args.workspaceRoot, rel);
    if (content !== undefined) {
      out.push({ relPath: normaliseRel(rel), content });
    }
  }
  return out;
}

function buildTerms(content: string, classBase: string, domainBase: string): {
  readonly classNames: readonly string[];
  readonly searchTerms: readonly string[];
} {
  const classNames = new Set<string>([classBase, ...classNamesMatching(content, ROLE_SUFFIX)]);
  for (const imported of importSymbols(content)) {
    classNames.add(imported);
  }
  const searchTerms = compactTerms([
    classBase,
    domainBase,
    ...classNames,
    ...tableNamesFor([domainBase, ...classNames]),
  ]);
  return { classNames: [...classNames], searchTerms };
}

function addWorkspaceManifests(candidates: Map<string, Candidate>): void {
  for (const rel of [
    'composer.json',
    'package.json',
    'pyproject.toml',
    'requirements.txt',
    'go.mod',
    'Cargo.toml',
    'Package.swift',
    'Gemfile',
  ]) {
    addFileCandidate(candidates, rel, 'Workspace dependency manifest for active packs', [rel], 1);
  }
}

function addImportedFiles(candidates: Map<string, Candidate>, target: TargetFile, workspaceRoot: string): void {
  for (const imported of phpWorkspaceNamespaceImports(target.content)) {
    addFileCandidate(candidates, imported.relPath, `Imported ${imported.fqcn}`, [imported.className], priorityForRel(imported.relPath));
  }
  for (const spec of relativeImportSpecs(target.content)) {
    for (const relPath of resolveRelativeImport(workspaceRoot, target.relPath, spec)) {
      addFileCandidate(candidates, relPath, `Relative import ${spec}`, [basenameWithoutExt(relPath)], 9);
    }
  }
}

function addClassNameFiles(candidates: Map<string, Candidate>, classes: readonly string[]): void {
  for (const className of classes) {
    addGlobCandidate(candidates, `**/${className}.*`, `Related symbol ${className}`, [className], priorityForClass(className), 'class');
  }
}

function addRoleConventions(candidates: Map<string, Candidate>, domainBase: string, classes: readonly string[]): void {
  if (!domainBase) {
    return;
  }
  addGlobCandidate(
    candidates,
    `**/{Models,models,Services,services,Actions,actions,Repositories,repositories,Requests,requests,Jobs,jobs,Events,events,Policies,policies,Stores,stores,Hooks,hooks,Composables,composables,Components,components}/**/${domainBase}*.*`,
    `Conventional related files for ${domainBase}`,
    [domainBase, ...classes],
    7,
    'class'
  );
}

function addRouteCandidates(
  candidates: Map<string, Candidate>,
  classBase: string,
  domainBase: string,
  targetRel: string,
  terms: readonly string[]
): void {
  const reason = `Route or entrypoint definitions referencing ${classBase}`;
  for (const glob of [
    'routes/**/*.*',
    'src/routes/**/*.*',
    'app/**/routes*.*',
    'pages/**/*.*',
    'app/**/{page,layout,route}.*',
  ]) {
    addGlobCandidate(candidates, glob, reason, [classBase, domainBase, targetRel, ...terms], 6, 'routes');
  }
}

function addSchemaCandidates(candidates: Map<string, Candidate>, tableNames: readonly string[], terms: readonly string[]): void {
  const schemaTerms = compactTerms([...tableNames, ...terms]);
  if (schemaTerms.length === 0) {
    return;
  }
  for (const glob of [
    'database/{migrations,schemas,seeders}/**/*.*',
    'db/{migrations,schema,seeders}/**/*.*',
    'prisma/**/*.prisma',
    'migrations/**/*.*',
  ]) {
    addGlobCandidate(candidates, glob, `Database schema touching ${schemaTerms.slice(0, 4).join(', ')}`, schemaTerms, 5, 'schema');
  }
}

function addTests(
  candidates: Map<string, Candidate>,
  classBase: string,
  domainBase: string,
  terms: readonly string[]
): void {
  const testTerms = compactTerms([classBase, domainBase, ...terms]);
  for (const glob of [
    'tests/**/*.*',
    'test/**/*.*',
    '__tests__/**/*.*',
    '**/*.{test,spec}.*',
    '**/*{Test,Tests,Spec}.*',
  ]) {
    addGlobCandidate(candidates, glob, `Tests covering ${domainBase || classBase}`, testTerms, 4, 'tests');
  }
}

function addConfigFiles(candidates: Map<string, Candidate>, content: string): void {
  for (const key of configKeys(content)) {
    const root = key.split('.')[0];
    if (root) {
      for (const ext of ['php', 'ts', 'js', 'json', 'yaml', 'yml']) {
        addFileCandidate(candidates, `config/${root}.${ext}`, `Config read via ${key}`, [key, root], 3);
      }
    }
  }
  if (/\bprocess\.env\.|import\.meta\.env\.|os\.environ|std::env::|System\.getenv|env\s*\(/.test(content)) {
    addGlobCandidate(candidates, 'config/**/*.*', 'Config files near environment-driven code', envKeys(content), 2, 'config');
  }
}

function collectEnvNotes(notes: Set<string>, content: string, relPath: string): void {
  const vars = envKeys(content);
  if (vars.length > 0) {
    notes.add(`${relPath} references environment variable names: ${vars.join(', ')}. .env values were not read.`);
  }
}

async function addClassMatches(candidates: Map<string, Candidate>, workspaceRoot: string): Promise<void> {
  await expandGlobCandidates(
    candidates,
    workspaceRoot,
    (candidate) => candidate.kind === 'class',
    () => true
  );
}

async function addContentMatches(
  candidates: Map<string, Candidate>,
  workspaceRoot: string,
  kind: Candidate['kind']
): Promise<void> {
  await expandGlobCandidates(
    candidates,
    workspaceRoot,
    (candidate) => candidate.kind === kind,
    (candidate, rel, content) => {
      const lowerRel = rel.toLowerCase();
      return candidate.terms.some((term) => {
        const lower = term.toLowerCase();
        return lower.length > 1 && (content.includes(term) || lowerRel.includes(lower));
      });
    }
  );
}

async function addConfigMatches(
  candidates: Map<string, Candidate>,
  workspaceRoot: string,
  notes: Set<string>
): Promise<void> {
  const current = [...candidates.values()];
  for (const candidate of current) {
    const content = candidate.relPath.includes('*') ? undefined : await readUtf8(workspaceRoot, candidate.relPath);
    if (content === undefined) {
      continue;
    }
    collectEnvNotes(notes, content, candidate.relPath);
    for (const key of configKeys(content)) {
      const root = key.split('.')[0];
      if (root) {
        addFileCandidate(candidates, `config/${root}.php`, `Config read by ${candidate.relPath}`, [key, root], 2);
      }
    }
  }
}

async function expandGlobCandidates(
  candidates: Map<string, Candidate>,
  workspaceRoot: string,
  shouldExpand: (candidate: Candidate) => boolean,
  include: (candidate: Candidate, rel: string, content: string) => boolean
): Promise<void> {
  const globs = [...candidates.values()].filter(shouldExpand);
  for (const glob of globs) {
    candidates.delete(glob.relPath);
    const uris = await vscode.workspace.findFiles(new vscode.RelativePattern(workspaceRoot, glob.relPath), EXCLUDE_GLOB, 80);
    for (const uri of uris) {
      const rel = toRel(workspaceRoot, uri.fsPath);
      if (!isCollectablePath(rel)) {
        continue;
      }
      const content = await readUtf8(workspaceRoot, rel);
      if (content !== undefined && include(glob, rel, content)) {
        addFileCandidate(candidates, rel, glob.reason, glob.terms, glob.priority, 'file');
      }
    }
  }
}

async function materialiseCandidates(
  workspaceRoot: string,
  candidates: Map<string, Candidate>,
  targetRels: readonly string[]
): Promise<RelatedContextFile[]> {
  const targetSet = new Set(targetRels.map(normaliseRel));
  const ordered = [...candidates.values()]
    .filter((c) => !c.relPath.includes('*'))
    .filter((c) => !targetSet.has(normaliseRel(c.relPath)))
    .sort((a, b) => b.priority - a.priority || a.relPath.localeCompare(b.relPath));

  const out: RelatedContextFile[] = [];
  let total = 0;
  const seen = new Set<string>();
  for (const candidate of ordered) {
    const rel = normaliseRel(candidate.relPath);
    if (seen.has(rel) || out.length >= MAX_RELATED_FILES || total >= MAX_TOTAL_EXCERPT_CHARS) {
      continue;
    }
    seen.add(rel);
    const content = await readUtf8(workspaceRoot, rel);
    if (content === undefined) {
      continue;
    }
    const remaining = MAX_TOTAL_EXCERPT_CHARS - total;
    const excerpt = excerptFor(content, candidate.terms, Math.min(MAX_EXCERPT_CHARS, remaining));
    if (!excerpt.trim()) {
      continue;
    }
    out.push({ path: rel, reason: candidate.reason, excerpt });
    total += excerpt.length;
  }
  return out;
}

function addFileCandidate(
  candidates: Map<string, Candidate>,
  relPath: string,
  reason: string,
  terms: readonly string[],
  priority: number,
  kind: Candidate['kind'] = 'file'
): void {
  const rel = normaliseRel(relPath);
  const existing = candidates.get(rel);
  if (existing && existing.priority >= priority) {
    return;
  }
  candidates.set(rel, { relPath: rel, reason, terms: compactTerms(terms), priority, kind });
}

function addGlobCandidate(
  candidates: Map<string, Candidate>,
  glob: string,
  reason: string,
  terms: readonly string[],
  priority: number,
  kind: Candidate['kind']
): void {
  addFileCandidate(candidates, glob, reason, terms, priority, kind);
}

function phpWorkspaceNamespaceImports(content: string): Array<{ fqcn: string; className: string; relPath: string }> {
  return [...content.matchAll(/^\s*use\s+((?:App|Src)\\[A-Za-z0-9_\\]+);/gm)].map((m) => {
    const fqcn = m[1];
    const className = fqcn.split('\\').pop() ?? fqcn;
    const root = fqcn.startsWith('Src\\') ? 'src\\' : 'app\\';
    return {
      fqcn,
      className,
      relPath: `${fqcn.replace(/^(App|Src)\\/, root).replace(/\\/g, '/')}.php`,
    };
  });
}

function relativeImportSpecs(content: string): string[] {
  const specs = new Set<string>();
  for (const regex of [
    /\bimport\s+(?:[^'"]+\s+from\s+)?['"](\.{1,2}\/[^'"]+)['"]/g,
    /\bexport\s+[^'"]+\s+from\s+['"](\.{1,2}\/[^'"]+)['"]/g,
    /\brequire\s*\(\s*['"](\.{1,2}\/[^'"]+)['"]\s*\)/g,
    /^\s*from\s+(\.{1,2}[A-Za-z0-9_./]+)\s+import\s+/gm,
    /^\s*import\s+(\.{1,2}[A-Za-z0-9_./]+)\s*$/gm,
  ]) {
    for (const m of content.matchAll(regex)) {
      specs.add(m[1]);
    }
  }
  return [...specs];
}

function resolveRelativeImport(_workspaceRoot: string, fromRelPath: string, spec: string): string[] {
  const fromDir = path.posix.dirname(fromRelPath.replace(/\\/g, '/'));
  const finalBase = path.posix.normalize(path.posix.join(fromDir, spec));
  // Reject imports that resolve outside the workspace-relative tree.
  if (finalBase === '..' || finalBase.startsWith('../')) {
    return [];
  }
  const ext = path.extname(finalBase);
  if (ext && SOURCE_EXTENSIONS.includes(ext as (typeof SOURCE_EXTENSIONS)[number])) {
    return [finalBase];
  }
  const out: string[] = [];
  for (const sourceExt of SOURCE_EXTENSIONS) {
    out.push(`${finalBase}${sourceExt}`);
  }
  for (const sourceExt of SOURCE_EXTENSIONS) {
    out.push(`${finalBase}/index${sourceExt}`);
  }
  return out;
}

function importSymbols(content: string): string[] {
  const symbols = new Set<string>();
  for (const imported of phpWorkspaceNamespaceImports(content)) {
    symbols.add(imported.className);
  }
  for (const m of content.matchAll(/\bimport\s+(?:type\s+)?(?:[A-Z][A-Za-z0-9_]*|\{\s*([^}]+)\s*\})/g)) {
    const group = m[1] ?? m[0];
    for (const symbol of group.matchAll(/\b([A-Z][A-Za-z0-9_]{2,})\b/g)) {
      symbols.add(symbol[1]);
    }
  }
  return [...symbols];
}

function classNamesMatching(content: string, suffix: RegExp): string[] {
  const names = new Set<string>();
  for (const m of content.matchAll(/\b([A-Z][A-Za-z0-9_]{2,})\b/g)) {
    const name = m[1];
    if (suffix.test(name)) {
      names.add(name);
    }
  }
  return [...names];
}

function configKeys(content: string): string[] {
  const keys = new Set<string>();
  for (const key of uniqueMatches(content, /\bconfig\s*\(\s*['"]([a-zA-Z0-9_.-]+)['"]/g)) keys.add(key);
  for (const key of uniqueMatches(content, /\bConfig::get\s*\(\s*['"]([a-zA-Z0-9_.-]+)['"]/g)) keys.add(key);
  return [...keys].sort((a, b) => a.localeCompare(b));
}

function envKeys(content: string): string[] {
  const keys = new Set<string>();
  for (const key of uniqueMatches(content, /\benv\s*\(\s*['"]([A-Z0-9_]+)['"]/g)) keys.add(key);
  for (const key of uniqueMatches(content, /\bprocess\.env\.([A-Z0-9_]+)/g)) keys.add(key);
  for (const key of uniqueMatches(content, /\bimport\.meta\.env\.([A-Z0-9_]+)/g)) keys.add(key);
  for (const key of uniqueMatches(content, /\bos\.environ(?:\.get)?\(\s*['"]([A-Z0-9_]+)['"]/g)) keys.add(key);
  for (const key of uniqueMatches(content, /\bgetenv\(\s*['"]([A-Z0-9_]+)['"]/g)) keys.add(key);
  return [...keys].sort((a, b) => a.localeCompare(b)).slice(0, 20);
}

function uniqueMatches(content: string, regex: RegExp): string[] {
  const out = new Set<string>();
  for (const m of content.matchAll(regex)) {
    out.add(m[1]);
  }
  return [...out].sort((a, b) => a.localeCompare(b));
}

function tableNamesFor(names: readonly string[]): string[] {
  const out = new Set<string>();
  for (const name of names) {
    const stripped = stripRoleSuffix(name);
    if (!stripped || stripped.length < 3) {
      continue;
    }
    out.add(pluralise(snakeCase(stripped)));
  }
  return [...out];
}

function excerptFor(content: string, terms: readonly string[], maxChars: number): string {
  if (content.length <= maxChars) {
    return content;
  }
  const idx = firstTermIndex(content, terms);
  if (idx < 0) {
    return `${content.slice(0, maxChars - 20)}\n...`;
  }
  const start = Math.max(0, idx - EXCERPT_RADIUS);
  const end = Math.min(content.length, start + maxChars);
  const prefix = start > 0 ? '...\n' : '';
  const suffix = end < content.length ? '\n...' : '';
  return `${prefix}${content.slice(start, end)}${suffix}`;
}

function firstTermIndex(content: string, terms: readonly string[]): number {
  let best = -1;
  for (const term of terms) {
    if (term.length < 2) {
      continue;
    }
    const idx = content.indexOf(term);
    if (idx >= 0 && (best < 0 || idx < best)) {
      best = idx;
    }
  }
  return best;
}

async function readUtf8(workspaceRoot: string, relPath: string): Promise<string | undefined> {
  try {
    const resolved = resolveInsideWorkspace(workspaceRoot, relPath);
    if (!resolved) {
      return undefined;
    }
    const uri = vscode.Uri.file(resolved);
    const bytes = await vscode.workspace.fs.readFile(uri);
    return Buffer.from(bytes).toString('utf8');
  } catch {
    return undefined;
  }
}

function basenameWithoutExt(relPath: string): string {
  return path.basename(relPath, path.extname(relPath));
}

function toRel(workspaceRoot: string, filePath: string): string {
  if (!path.isAbsolute(filePath)) {
    const normalised = normaliseRel(filePath);
    if (normalised.startsWith('..')) {
      return '';
    }
    return normalised;
  }
  const rel = normaliseRel(path.relative(workspaceRoot, filePath));
  if (!rel || rel.startsWith('..')) {
    return '';
  }
  return rel;
}

function normaliseRel(relPath: string): string {
  return relPath.replace(/\\/g, '/').replace(/^\/+/, '');
}

function compactTerms(terms: readonly string[]): string[] {
  return [...new Set(terms.filter((t) => t && t.length > 1))].slice(0, 32);
}

function priorityForClass(className: string): number {
  if (/Service|Action|Repository|Store|Hook|Composable|Handler$/.test(className)) {
    return 9;
  }
  if (/Request|Rule|Command$/.test(className)) {
    return 8;
  }
  if (/Model|Component|View$/.test(className)) {
    return 7;
  }
  if (/Job|Event|Listener|Observer|Notification|Policy$/.test(className)) {
    return 6;
  }
  return 5;
}

function priorityForRel(relPath: string): number {
  const normal = relPath.replace(/\\/g, '/');
  if (/\/(Services|services|Actions|actions|Stores|stores|Hooks|hooks|Composables|composables|Handlers|handlers)\//.test(normal)) {
    return 9;
  }
  if (/\/(Requests|requests|Rules|rules|Commands|commands)\//.test(normal)) {
    return 8;
  }
  if (/\/(Models|models|Components|components|Views|views)\//.test(normal)) {
    return 7;
  }
  if (/\/(Policies|policies|Jobs|jobs|Events|events|Listeners|listeners)\//.test(normal)) {
    return 6;
  }
  return 5;
}

function stripRoleSuffix(input: string): string {
  return input.replace(ROLE_SUFFIX, '');
}

function snakeCase(input: string): string {
  return input
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1_$2')
    .replace(/[-\s]+/g, '_')
    .toLowerCase();
}

function pluralise(input: string): string {
  if (input.endsWith('y')) {
    return `${input.slice(0, -1)}ies`;
  }
  if (input.endsWith('s')) {
    return input;
  }
  return `${input}s`;
}

function isCollectablePath(filePath: string): boolean {
  if (!filePath || filePath.startsWith('..')) {
    return false;
  }
  const ext = path.extname(filePath).toLowerCase();
  if (BINARY_EXTENSIONS.has(ext)) {
    return false;
  }
  const base = path.basename(filePath).toLowerCase();
  return !base.endsWith('.min.js') && !base.endsWith('.map');
}
