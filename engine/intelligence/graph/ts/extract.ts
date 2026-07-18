import ts from 'typescript';
import type {
  DependencyEdge,
  EdgeConfidence,
  EdgeResolutionMethod,
  SymbolParameter,
  SymbolRecord,
} from '../../contracts';
import type { TsProgramHost } from './program-host';
import { absToRel, languageForTsJs, normaliseRel } from './paths';
import { buildSymbolId, edgeId } from './symbol-id';
import { detectTestCoverageEdges } from './test-relations';

export interface ExtractFileResult {
  readonly symbols: readonly SymbolRecord[];
  readonly edges: readonly DependencyEdge[];
  readonly usedCompiler: boolean;
}

function locOf(
  sf: ts.SourceFile,
  node: ts.Node,
  relPath: string
): SymbolRecord['location'] {
  const start = sf.getLineAndCharacterOfPosition(node.getStart(sf, false));
  const end = sf.getLineAndCharacterOfPosition(node.getEnd());
  return {
    path: relPath,
    startLine: start.line + 1,
    startColumn: start.character + 1,
    endLine: end.line + 1,
    endColumn: end.character + 1,
  };
}

function jsdocSummary(node: ts.Node): string | undefined {
  const tags = ts.getJSDocCommentsAndTags(node);
  for (const t of tags) {
    if (ts.isJSDoc(t) && t.comment) {
      if (typeof t.comment === 'string') {
        return t.comment.trim().split(/\r?\n/)[0]?.trim();
      }
      return t.comment
        .map((c) => (typeof c === 'string' ? c : c.text))
        .join('')
        .trim()
        .split(/\r?\n/)[0]
        ?.trim();
    }
  }
  return undefined;
}

function declarationExported(node: ts.Node): boolean {
  let current: ts.Node | undefined = node;
  while (current) {
    const flags = ts.getCombinedModifierFlags(current as ts.Declaration);
    if (flags & ts.ModifierFlags.Export || flags & ts.ModifierFlags.Default) {
      return true;
    }
    if (ts.isSourceFile(current)) {
      break;
    }
    current = current.parent;
  }
  return false;
}

function paramsOf(
  checker: ts.TypeChecker,
  signature: ts.Signature | undefined,
  decl: ts.SignatureDeclaration | undefined
): SymbolParameter[] | undefined {
  const params = signature?.getParameters() ?? [];
  if (params.length === 0 && decl?.parameters) {
    return decl.parameters.map((p) => ({
      name: p.name.getText(),
      optional: Boolean(p.questionToken || p.initializer),
      rest: Boolean(p.dotDotDotToken),
      typeText: p.type ? p.type.getText() : undefined,
    }));
  }
  if (params.length === 0) {
    return undefined;
  }
  return params.map((p) => {
    const decls = p.valueDeclaration;
    const optional =
      decls && ts.isParameter(decls)
        ? Boolean(decls.questionToken || decls.initializer)
        : false;
    const rest = decls && ts.isParameter(decls) ? Boolean(decls.dotDotDotToken) : false;
    let typeText: string | undefined;
    try {
      typeText = checker.typeToString(checker.getTypeOfSymbolAtLocation(p, decls ?? (decl as ts.Node)));
    } catch {
      typeText = undefined;
    }
    return { name: p.getName(), typeText, optional, rest };
  });
}

function returnTypeOf(
  checker: ts.TypeChecker,
  signature: ts.Signature | undefined
): string | undefined {
  if (!signature) {
    return undefined;
  }
  try {
    return checker.typeToString(signature.getReturnType());
  } catch {
    return undefined;
  }
}

function enclosingSymbolId(
  sf: ts.SourceFile,
  node: ts.Node,
  relPath: string,
  symbols: Map<ts.Node, string>
): string | undefined {
  let current: ts.Node | undefined = node.parent;
  while (current && current !== sf) {
    const id = symbols.get(current);
    if (id) {
      return id;
    }
    current = current.parent;
  }
  // Fallback: nearest function/class by walking
  current = node.parent;
  while (current && current !== sf) {
    if (
      ts.isFunctionDeclaration(current) ||
      ts.isMethodDeclaration(current) ||
      ts.isConstructorDeclaration(current) ||
      ts.isClassDeclaration(current) ||
      ts.isFunctionExpression(current) ||
      ts.isArrowFunction(current)
    ) {
      const nameNode =
        (current as ts.NamedDeclaration).name ??
        (ts.isConstructorDeclaration(current) ? current : undefined);
      const name = nameNode && ts.isIdentifier(nameNode) ? nameNode.text : 'anonymous';
      const kind = ts.isConstructorDeclaration(current)
        ? 'constructor'
        : ts.isMethodDeclaration(current)
          ? 'method'
          : ts.isClassDeclaration(current)
            ? 'class'
            : 'function';
      const loc = locOf(sf, current, relPath);
      return buildSymbolId({
        filePath: relPath,
        name: ts.isConstructorDeclaration(current) ? 'constructor' : name,
        kind,
        startLine: loc.startLine,
        startColumn: loc.startColumn ?? 1,
      });
    }
    current = current.parent;
  }
  return undefined;
}

function targetSymbolIdFromSymbol(
  _host: TsProgramHost,
  workspaceRoot: string,
  checker: ts.TypeChecker,
  symbol: ts.Symbol | undefined
): { symbolId?: string; fileRel?: string; name?: string } {
  if (!symbol) {
    return {};
  }
  let resolved = symbol;
  if (symbol.flags & ts.SymbolFlags.Alias) {
    try {
      resolved = checker.getAliasedSymbol(symbol);
    } catch {
      resolved = symbol;
    }
  }
  const decl =
    resolved.valueDeclaration ??
    resolved.declarations?.[0] ??
    symbol.valueDeclaration ??
    symbol.declarations?.[0];
  if (!decl) {
    return { name: resolved.getName() };
  }
  const sf = decl.getSourceFile();
  const rel = normaliseRel(absToRel(workspaceRoot, sf.fileName));
  const name = resolved.getName() === 'default' ? 'default' : resolved.getName();
  let kind = 'reference';
  if (ts.isFunctionDeclaration(decl) || ts.isFunctionExpression(decl) || ts.isArrowFunction(decl)) {
    kind = 'function';
  } else if (ts.isMethodDeclaration(decl) || ts.isMethodSignature(decl)) {
    kind = 'method';
  } else if (ts.isConstructorDeclaration(decl)) {
    kind = 'constructor';
  } else if (ts.isClassDeclaration(decl)) {
    kind = 'class';
  } else if (ts.isInterfaceDeclaration(decl)) {
    kind = 'interface';
  } else if (ts.isTypeAliasDeclaration(decl)) {
    kind = 'typeAlias';
  } else if (ts.isEnumDeclaration(decl)) {
    kind = 'enum';
  } else if (ts.isVariableDeclaration(decl)) {
    kind = 'const';
  }
  const loc = locOf(sf, decl, rel);
  return {
    symbolId: buildSymbolId({
      filePath: rel,
      name: kind === 'constructor' ? 'constructor' : name,
      kind,
      startLine: loc.startLine,
      startColumn: loc.startColumn ?? 1,
    }),
    fileRel: rel,
    name,
  };
}

/**
 * Extract symbols and graph edges for one file using the TypeScript checker.
 */
export function extractFileWithCompiler(
  host: TsProgramHost,
  relPath: string
): ExtractFileResult | undefined {
  const sf = host.getSourceFile(relPath);
  const checker = host.getChecker(relPath);
  if (!sf || !checker) {
    return undefined;
  }
  const rel = normaliseRel(relPath);
  const language = languageForTsJs(rel);
  const symbols: SymbolRecord[] = [];
  const edges: DependencyEdge[] = [];
  const seenEdgeIds = new Set<string>();
  const nodeToId = new Map<ts.Node, string>();
  const workspaceRoot = host.workspaceRoot;

  const pushEdge = (edge: DependencyEdge): void => {
    if (seenEdgeIds.has(edge.id)) {
      return;
    }
    seenEdgeIds.add(edge.id);
    edges.push(edge);
  };

  const addSymbol = (
    node: ts.Node,
    name: string,
    kind: string,
    extras?: Partial<SymbolRecord>
  ): string => {
    const location = locOf(sf, node, rel);
    const id = buildSymbolId({
      filePath: rel,
      name,
      kind,
      startLine: location.startLine,
      startColumn: location.startColumn ?? 1,
      overloadIndex: extras?.overloadIndex,
    });
    const record: SymbolRecord = {
      id,
      name,
      kind,
      location,
      language,
      exported: extras?.exported ?? declarationExported(node),
      containerName: extras?.containerName,
      parameters: extras?.parameters,
      returnTypeText: extras?.returnTypeText,
      jsdocSummary: extras?.jsdocSummary ?? jsdocSummary(node),
      signatureText: extras?.signatureText,
      overloadIndex: extras?.overloadIndex,
    };
    symbols.push(record);
    nodeToId.set(node, id);
    return id;
  };

  const visitDeclaration = (node: ts.Node, containerName?: string): void => {
    if (ts.isFunctionDeclaration(node) && node.name) {
      const sigs = checker.getSignaturesOfType(
        checker.getTypeAtLocation(node),
        ts.SignatureKind.Call
      );
      if (sigs.length > 1) {
        sigs.forEach((sig, i) => {
          addSymbol(node, node.name!.text, 'function', {
            containerName,
            exported: declarationExported(node),
            parameters: paramsOf(checker, sig, node),
            returnTypeText: returnTypeOf(checker, sig),
            signatureText: checker.signatureToString(sig),
            overloadIndex: i,
            jsdocSummary: jsdocSummary(node),
          });
        });
      } else {
        const sig = sigs[0] ?? checker.getSignatureFromDeclaration(node);
        addSymbol(node, node.name.text, 'function', {
          containerName,
          parameters: paramsOf(checker, sig, node),
          returnTypeText: returnTypeOf(checker, sig),
          signatureText: sig ? checker.signatureToString(sig) : undefined,
        });
      }
    } else if (ts.isClassDeclaration(node) && node.name) {
      const classId = addSymbol(node, node.name.text, 'class', { containerName });
      for (const member of node.members) {
        visitDeclaration(member, node.name.text);
      }
      // heritage
      if (node.heritageClauses) {
        for (const clause of node.heritageClauses) {
          const kind =
            clause.token === ts.SyntaxKind.ExtendsKeyword ? 'extends' : 'implements';
          for (const typeNode of clause.types) {
            const typeSym = checker.getSymbolAtLocation(typeNode.expression);
            const target = targetSymbolIdFromSymbol(host, workspaceRoot, checker, typeSym);
            const typeLoc = locOf(sf, typeNode, rel);
            pushEdge({
              id: edgeId([rel, kind, classId, target.symbolId, typeLoc.startLine]),
              fromPath: rel,
              toPath: target.fileRel ?? rel,
              kind,
              specifier: typeNode.expression.getText(),
              fromSymbol: classId,
              toSymbol: target.symbolId,
              startLine: typeLoc.startLine,
              startColumn: typeLoc.startColumn,
              endLine: typeLoc.endLine,
              endColumn: typeLoc.endColumn,
              confidence: target.symbolId ? 'certain' : 'heuristic',
              resolutionMethod: target.symbolId ? 'typescript-checker' : 'unresolved',
            });
            if (target.symbolId) {
              pushEdge({
                id: edgeId([rel, 'typeUsage', classId, target.symbolId, typeLoc.startLine]),
                fromPath: rel,
                toPath: target.fileRel ?? rel,
                kind: 'typeUsage',
                specifier: typeNode.expression.getText(),
                fromSymbol: classId,
                toSymbol: target.symbolId,
                startLine: typeLoc.startLine,
                startColumn: typeLoc.startColumn,
                confidence: 'certain',
                resolutionMethod: 'typescript-checker',
              });
            }
          }
        }
      }
    } else if (ts.isInterfaceDeclaration(node) && node.name) {
      const ifaceId = addSymbol(node, node.name.text, 'interface', { containerName });
      if (node.heritageClauses) {
        for (const clause of node.heritageClauses) {
          for (const typeNode of clause.types) {
            const typeSym = checker.getSymbolAtLocation(typeNode.expression);
            const target = targetSymbolIdFromSymbol(host, workspaceRoot, checker, typeSym);
            const typeLoc = locOf(sf, typeNode, rel);
            pushEdge({
              id: edgeId([rel, 'extends', ifaceId, target.symbolId, typeLoc.startLine]),
              fromPath: rel,
              toPath: target.fileRel ?? rel,
              kind: 'extends',
              specifier: typeNode.expression.getText(),
              fromSymbol: ifaceId,
              toSymbol: target.symbolId,
              startLine: typeLoc.startLine,
              startColumn: typeLoc.startColumn,
              confidence: target.symbolId ? 'certain' : 'heuristic',
              resolutionMethod: target.symbolId ? 'typescript-checker' : 'unresolved',
            });
          }
        }
      }
      for (const member of node.members) {
        if (ts.isMethodSignature(member) && member.name && ts.isIdentifier(member.name)) {
          const sig = checker.getSignatureFromDeclaration(member);
          addSymbol(member, member.name.text, 'method', {
            containerName: node.name.text,
            parameters: paramsOf(checker, sig, member),
            returnTypeText: returnTypeOf(checker, sig),
          });
        }
      }
    } else if (ts.isTypeAliasDeclaration(node)) {
      addSymbol(node, node.name.text, 'typeAlias', { containerName });
      // type usage in alias
      const visitTypes = (n: ts.Node): void => {
        if (ts.isTypeReferenceNode(n) && ts.isIdentifier(n.typeName)) {
          const typeSym = checker.getSymbolAtLocation(n.typeName);
          const target = targetSymbolIdFromSymbol(host, workspaceRoot, checker, typeSym);
          if (target.symbolId) {
            const fromId = nodeToId.get(node);
            const typeLoc = locOf(sf, n, rel);
            pushEdge({
              id: edgeId([rel, 'typeUsage', fromId, target.symbolId, typeLoc.startLine]),
              fromPath: rel,
              toPath: target.fileRel ?? rel,
              kind: 'typeUsage',
              specifier: n.typeName.text,
              fromSymbol: fromId,
              toSymbol: target.symbolId,
              startLine: typeLoc.startLine,
              startColumn: typeLoc.startColumn,
              confidence: 'certain',
              resolutionMethod: 'typescript-checker',
            });
          }
        }
        ts.forEachChild(n, visitTypes);
      };
      visitTypes(node.type);
    } else if (ts.isEnumDeclaration(node)) {
      addSymbol(node, node.name.text, 'enum', { containerName });
    } else if (ts.isModuleDeclaration(node) && ts.isIdentifier(node.name)) {
      addSymbol(node, node.name.text, 'module', { containerName });
      if (node.body && ts.isModuleBlock(node.body)) {
        for (const st of node.body.statements) {
          visitDeclaration(st, node.name.text);
        }
      }
    } else if (ts.isMethodDeclaration(node) && node.name && ts.isIdentifier(node.name)) {
      const sig = checker.getSignatureFromDeclaration(node);
      addSymbol(node, node.name.text, 'method', {
        containerName,
        parameters: paramsOf(checker, sig, node),
        returnTypeText: returnTypeOf(checker, sig),
        signatureText: sig ? checker.signatureToString(sig) : undefined,
      });
    } else if (ts.isConstructorDeclaration(node)) {
      const sig = checker.getSignatureFromDeclaration(node);
      addSymbol(node, 'constructor', 'constructor', {
        containerName,
        parameters: paramsOf(checker, sig, node),
        returnTypeText: returnTypeOf(checker, sig),
      });
    } else if (ts.isVariableStatement(node)) {
      const exported = declarationExported(node);
      for (const decl of node.declarationList.declarations) {
        if (!ts.isIdentifier(decl.name)) {
          continue;
        }
        const init = decl.initializer;
        const isFn =
          init &&
          (ts.isArrowFunction(init) ||
            ts.isFunctionExpression(init));
        if (isFn) {
          const sig = checker.getSignatureFromDeclaration(init);
          addSymbol(decl, decl.name.text, 'function', {
            containerName,
            exported,
            parameters: paramsOf(checker, sig, init),
            returnTypeText: returnTypeOf(checker, sig),
          });
        } else if (exported || node.declarationList.flags & ts.NodeFlags.Const) {
          // Exported constants (and const bindings)
          if (exported) {
            let typeText: string | undefined;
            try {
              typeText = checker.typeToString(checker.getTypeAtLocation(decl));
            } catch {
              typeText = undefined;
            }
            addSymbol(decl, decl.name.text, 'const', {
              containerName,
              exported: true,
              returnTypeText: typeText,
            });
          }
        }
      }
    }
  };

  for (const stmt of sf.statements) {
    visitDeclaration(stmt);
  }

  // Imports / exports / file deps
  for (const stmt of sf.statements) {
    if (ts.isImportDeclaration(stmt) && stmt.moduleSpecifier && ts.isStringLiteral(stmt.moduleSpecifier)) {
      const specifier = stmt.moduleSpecifier.text;
      const resolved = host.resolveModule(rel, specifier);
      const loc = locOf(sf, stmt, rel);
      const toPath = resolved.resolvedRel ?? specifier;
      const confidence: EdgeConfidence = resolved.resolvedRel ? 'certain' : 'heuristic';
      const resolutionMethod: EdgeResolutionMethod = resolved.resolvedRel
        ? resolved.usedPathAlias
          ? 'path-alias'
          : 'typescript-checker'
        : 'unresolved';
      pushEdge({
        id: edgeId([rel, 'import', specifier, loc.startLine]),
        fromPath: rel,
        toPath,
        kind: 'import',
        specifier,
        startLine: loc.startLine,
        startColumn: loc.startColumn,
        endLine: loc.endLine,
        endColumn: loc.endColumn,
        confidence,
        resolutionMethod,
      });
      if (resolved.resolvedRel) {
        pushEdge({
          id: edgeId([rel, 'fileDependency', resolved.resolvedRel, loc.startLine]),
          fromPath: rel,
          toPath: resolved.resolvedRel,
          kind: 'fileDependency',
          specifier,
          startLine: loc.startLine,
          confidence: 'certain',
          resolutionMethod: resolved.usedPathAlias ? 'path-alias' : 'typescript-checker',
        });
      }
    }

    if (ts.isExportDeclaration(stmt)) {
      const loc = locOf(sf, stmt, rel);
      if (stmt.moduleSpecifier && ts.isStringLiteral(stmt.moduleSpecifier)) {
        const specifier = stmt.moduleSpecifier.text;
        const resolved = host.resolveModule(rel, specifier);
        const toPath = resolved.resolvedRel ?? specifier;
        pushEdge({
          id: edgeId([rel, 'export', specifier, loc.startLine]),
          fromPath: rel,
          toPath,
          kind: 'export',
          specifier,
          startLine: loc.startLine,
          startColumn: loc.startColumn,
          confidence: resolved.resolvedRel ? 'certain' : 'heuristic',
          resolutionMethod: resolved.resolvedRel
            ? resolved.usedPathAlias
              ? 'path-alias'
              : 'typescript-checker'
            : 'unresolved',
        });
        if (resolved.resolvedRel) {
          pushEdge({
            id: edgeId([rel, 'fileDependency', resolved.resolvedRel, loc.startLine, 're']),
            fromPath: rel,
            toPath: resolved.resolvedRel,
            kind: 'fileDependency',
            specifier,
            startLine: loc.startLine,
            confidence: 'certain',
            resolutionMethod: resolved.usedPathAlias ? 'path-alias' : 'typescript-checker',
          });
        }
      } else {
        pushEdge({
          id: edgeId([rel, 'export', 'local', loc.startLine]),
          fromPath: rel,
          toPath: rel,
          kind: 'export',
          specifier: stmt.getText().slice(0, 80),
          startLine: loc.startLine,
          confidence: 'certain',
          resolutionMethod: 'typescript-ast',
        });
      }
    }

    if (ts.isExportAssignment(stmt)) {
      const loc = locOf(sf, stmt, rel);
      pushEdge({
        id: edgeId([rel, 'export', 'default', loc.startLine]),
        fromPath: rel,
        toPath: rel,
        kind: 'export',
        specifier: 'default',
        startLine: loc.startLine,
        confidence: 'certain',
        resolutionMethod: 'typescript-ast',
      });
    }
  }

  // Calls + references (cross-file preferred for references)
  const visitExpr = (node: ts.Node): void => {
    if (ts.isCallExpression(node)) {
      const fromSym = enclosingSymbolId(sf, node, rel, nodeToId);
      const loc = locOf(sf, node.expression, rel);
      const expr = node.expression;

      // dynamic import()
      if (node.expression.kind === ts.SyntaxKind.ImportKeyword) {
        const arg = node.arguments[0];
        const specifier = arg && ts.isStringLiteral(arg) ? arg.text : '<dynamic>';
        const resolved: { resolvedRel?: string; usedPathAlias?: boolean } =
          arg && ts.isStringLiteral(arg) ? host.resolveModule(rel, arg.text) : {};
        pushEdge({
          id: edgeId([rel, 'import', 'dynamic', loc.startLine, specifier]),
          fromPath: rel,
          toPath: resolved.resolvedRel ?? specifier,
          kind: 'import',
          specifier,
          fromSymbol: fromSym,
          startLine: loc.startLine,
          startColumn: loc.startColumn,
          confidence: resolved.resolvedRel && arg && ts.isStringLiteral(arg) ? 'high' : 'heuristic',
          resolutionMethod: resolved.resolvedRel ? 'typescript-checker' : 'unresolved',
          evidence: ['dynamic-import'],
        });
        ts.forEachChild(node, visitExpr);
        return;
      }

      // require(...)
      if (ts.isIdentifier(expr) && expr.text === 'require') {
        const arg = node.arguments[0];
        const specifier = arg && ts.isStringLiteral(arg) ? arg.text : '<dynamic>';
        const resolved: { resolvedRel?: string; usedPathAlias?: boolean } =
          arg && ts.isStringLiteral(arg) ? host.resolveModule(rel, arg.text) : {};
        pushEdge({
          id: edgeId([rel, 'require', specifier, loc.startLine]),
          fromPath: rel,
          toPath: resolved.resolvedRel ?? specifier,
          kind: 'require',
          specifier,
          fromSymbol: fromSym,
          startLine: loc.startLine,
          confidence:
            resolved.resolvedRel && arg && ts.isStringLiteral(arg) ? 'certain' : 'heuristic',
          resolutionMethod: resolved.resolvedRel ? 'typescript-checker' : 'unresolved',
        });
        ts.forEachChild(node, visitExpr);
        return;
      }

      const isDynamicCallee =
        ts.isElementAccessExpression(expr) ||
        (ts.isPropertyAccessExpression(expr) && expr.questionDotToken !== undefined);

      let called: ts.Symbol | undefined;
      try {
        called = checker.getSymbolAtLocation(expr);
        if (!called && ts.isPropertyAccessExpression(expr)) {
          called = checker.getSymbolAtLocation(expr.name);
        }
      } catch {
        called = undefined;
      }

      const target = targetSymbolIdFromSymbol(host, workspaceRoot, checker, called);
      if (target.symbolId && !isDynamicCallee) {
        pushEdge({
          id: edgeId([rel, 'call', fromSym, target.symbolId, loc.startLine, loc.startColumn]),
          fromPath: rel,
          toPath: target.fileRel ?? rel,
          kind: 'call',
          specifier: expr.getText().slice(0, 120),
          fromSymbol: fromSym,
          toSymbol: target.symbolId,
          startLine: loc.startLine,
          startColumn: loc.startColumn,
          endLine: loc.endLine,
          endColumn: loc.endColumn,
          confidence: 'certain',
          resolutionMethod: 'typescript-checker',
        });
      } else {
        pushEdge({
          id: edgeId([rel, 'call', 'unresolved', loc.startLine, loc.startColumn, expr.getText()]),
          fromPath: rel,
          toPath: target.fileRel ?? rel,
          kind: 'call',
          specifier: expr.getText().slice(0, 120),
          fromSymbol: fromSym,
          toSymbol: target.symbolId,
          startLine: loc.startLine,
          startColumn: loc.startColumn,
          confidence: 'heuristic',
          resolutionMethod: 'unresolved',
          evidence: isDynamicCallee ? ['dynamic-callee'] : ['unresolved-call'],
        });
      }
    } else if (ts.isIdentifier(node)) {
      const parent = node.parent;
      const isDeclName =
        (ts.isFunctionDeclaration(parent) ||
          ts.isClassDeclaration(parent) ||
          ts.isInterfaceDeclaration(parent) ||
          ts.isMethodDeclaration(parent) ||
          ts.isVariableDeclaration(parent) ||
          ts.isTypeAliasDeclaration(parent) ||
          ts.isEnumDeclaration(parent) ||
          ts.isParameter(parent)) &&
        parent.name === node;
      if (
        isDeclName ||
        (parent && (ts.isImportSpecifier(parent) || ts.isImportClause(parent)))
      ) {
        // skip declaration / import names
      } else {
        let sym: ts.Symbol | undefined;
        try {
          sym = checker.getSymbolAtLocation(node);
        } catch {
          sym = undefined;
        }
        const target = targetSymbolIdFromSymbol(host, workspaceRoot, checker, sym);
        if (target.symbolId && target.fileRel && target.fileRel !== rel) {
          const fromSym = enclosingSymbolId(sf, node, rel, nodeToId);
          const loc = locOf(sf, node, rel);
          pushEdge({
            id: edgeId([rel, 'reference', fromSym, target.symbolId, loc.startLine, loc.startColumn]),
            fromPath: rel,
            toPath: target.fileRel,
            kind: 'reference',
            specifier: node.text,
            fromSymbol: fromSym,
            toSymbol: target.symbolId,
            startLine: loc.startLine,
            startColumn: loc.startColumn,
            confidence: 'certain',
            resolutionMethod: 'typescript-checker',
          });
        }
      }
    }
    ts.forEachChild(node, visitExpr);
  };
  ts.forEachChild(sf, visitExpr);

  // Test coverage edges from this file if it looks like a test
  const testEdges = detectTestCoverageEdges(host, rel, sf, checker, symbols);
  for (const e of testEdges) {
    pushEdge(e);
  }

  return { symbols, edges, usedCompiler: true };
}

/** Position (1-based line/column) → declaration symbol id when resolvable. */
export function symbolAtPosition(
  host: TsProgramHost,
  relPath: string,
  position: { line: number; column: number }
): string | undefined {
  const sf = host.getSourceFile(relPath);
  const checker = host.getChecker(relPath);
  if (!sf || !checker) {
    return undefined;
  }
  const rel = normaliseRel(relPath);
  const offset = sf.getPositionOfLineAndCharacter(
    Math.max(0, position.line - 1),
    Math.max(0, position.column - 1)
  );
  let node: ts.Node = sf;
  const find = (n: ts.Node): void => {
    if (offset >= n.getStart(sf) && offset < n.getEnd()) {
      node = n;
      ts.forEachChild(n, find);
    }
  };
  find(sf);

  let sym = checker.getSymbolAtLocation(node);
  if (!sym && ts.isIdentifier(node)) {
    sym = checker.getSymbolAtLocation(node);
  }
  // Prefer declaration
  if (sym) {
    const target = targetSymbolIdFromSymbol(host, host.workspaceRoot, checker, sym);
    if (target.symbolId) {
      return target.symbolId;
    }
  }
  // If sitting on a declaration node
  let current: ts.Node | undefined = node;
  while (current) {
    if (
      (ts.isFunctionDeclaration(current) ||
        ts.isClassDeclaration(current) ||
        ts.isInterfaceDeclaration(current) ||
        ts.isMethodDeclaration(current) ||
        ts.isVariableDeclaration(current)) &&
      (current as ts.NamedDeclaration).name
    ) {
      const nameNode = (current as ts.NamedDeclaration).name!;
      const name = nameNode.getText();
      let kind = 'function';
      if (ts.isClassDeclaration(current)) kind = 'class';
      else if (ts.isInterfaceDeclaration(current)) kind = 'interface';
      else if (ts.isMethodDeclaration(current)) kind = 'method';
      else if (ts.isVariableDeclaration(current)) kind = 'const';
      const loc = locOf(sf, current, rel);
      return buildSymbolId({
        filePath: rel,
        name,
        kind,
        startLine: loc.startLine,
        startColumn: loc.startColumn ?? 1,
      });
    }
    current = current.parent;
  }
  return undefined;
}
