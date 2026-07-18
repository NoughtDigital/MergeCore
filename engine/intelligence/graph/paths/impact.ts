import type {
  ChangeImpactNode,
  ChangeImpactReport,
  ChangeImpactTarget,
  EdgeConfidence,
  TraverseBudget,
} from '../../contracts/types';
import { createInstructionResolver } from '../../instructions/resolver';
import type { RagStore } from '../../rag/store';
import { mergeTraverseBudget } from './budget';
import { isEntryPointPath, isIntegrationSpecifier, isTestPath } from './rank';
import {
  traverseRelationshipPaths,
  type TraverseStart,
} from './traverse';

export interface AnalyseChangeImpactOptions {
  readonly store: RagStore;
  readonly workspaceRoot: string;
  readonly target: ChangeImpactTarget;
  readonly budget?: TraverseBudget;
}

function asNode(
  path: string,
  reason: string,
  confidence: EdgeConfidence,
  symbolId?: string,
  name?: string
): ChangeImpactNode {
  return { path: path.replace(/\\/g, '/'), reason, confidence, symbolId, name };
}

/**
 * Likely impact of changing a symbol or file — not a guarantee.
 */
export async function analyseChangeImpact(
  options: AnalyseChangeImpactOptions
): Promise<ChangeImpactReport> {
  const budget = mergeTraverseBudget({
    weightProfile: 'impact',
    direction: 'incoming',
    maxDepth: options.budget?.maxDepth ?? 3,
    maxNodes: options.budget?.maxNodes ?? 80,
    maxPaths: options.budget?.maxPaths ?? 12,
    ...options.budget,
  });

  const start: TraverseStart = {
    symbolId: options.target.symbolId,
    path: options.target.path,
  };

  const downstream = traverseRelationshipPaths({
    store: options.store,
    start,
    budget: {
      ...budget,
      direction: 'both',
      weightProfile: 'impact',
    },
  });

  const dependents = traverseRelationshipPaths({
    store: options.store,
    start,
    budget: {
      ...budget,
      direction: 'incoming',
      maxDepth: 1,
      maxPaths: 40,
      weightProfile: 'impact',
    },
  });

  const directlyAffected: ChangeImpactNode[] = [];
  const seenDirect = new Set<string>();
  for (const p of dependents) {
    const leaf = p.steps[p.steps.length - 1];
    if (!leaf || p.steps.length < 2) continue;
    const key = leaf.node.symbolId ?? leaf.node.path;
    if (seenDirect.has(key)) continue;
    seenDirect.add(key);
    directlyAffected.push(
      asNode(
        leaf.node.path,
        leaf.edge ? `${leaf.edge.kind} ← ${leaf.edge.specifier}` : 'dependent',
        leaf.edge?.confidence ?? p.confidence,
        leaf.node.symbolId,
        leaf.node.name
      )
    );
  }

  const relatedTests: ChangeImpactNode[] = [];
  const publicInterfaces: ChangeImpactNode[] = [];
  const externalIntegrations: ChangeImpactNode[] = [];
  const uncertainDynamic: ChangeImpactNode[] = [];
  const seen = {
    test: new Set<string>(),
    pub: new Set<string>(),
    integ: new Set<string>(),
    unc: new Set<string>(),
  };

  for (const path of downstream) {
    for (const step of path.steps) {
      const key = step.node.symbolId ?? step.node.path;
      if (
        (isTestPath(step.node.path) || step.edge?.kind === 'likelyTestCoverage') &&
        !seen.test.has(key)
      ) {
        seen.test.add(key);
        relatedTests.push(
          asNode(
            step.node.path,
            'Related test in neighbourhood',
            step.edge?.confidence ?? 'medium',
            step.node.symbolId,
            step.node.name
          )
        );
      }
      if (
        (isEntryPointPath(step.node.path, step.node.name) ||
          step.edge?.kind === 'route' ||
          step.edge?.specifier?.startsWith('route:')) &&
        !seen.pub.has(key)
      ) {
        seen.pub.add(key);
        publicInterfaces.push(
          asNode(
            step.node.path,
            step.edge?.kind === 'route' || step.edge?.specifier?.startsWith('route:')
              ? 'Public route / entry'
              : 'Public/entry interface',
            step.edge?.confidence ?? 'high',
            step.node.symbolId,
            step.node.name
          )
        );
      }
      if (
        (step.edge?.kind === 'integration' ||
          (step.edge?.specifier && isIntegrationSpecifier(step.edge.specifier))) &&
        !seen.integ.has(key)
      ) {
        seen.integ.add(key);
        externalIntegrations.push(
          asNode(
            step.node.path,
            `External integration via ${step.edge?.specifier ?? 'import'}`,
            step.edge?.confidence ?? 'medium',
            step.node.symbolId,
            step.node.name
          )
        );
      }
      if (
        step.edge &&
        (step.edge.confidence === 'heuristic' ||
          step.edge.resolutionMethod === 'unresolved' ||
          step.edge.resolutionMethod === 'heuristic' ||
          /import\s*\(/i.test(step.edge.specifier)) &&
        !seen.unc.has(step.edge.id)
      ) {
        seen.unc.add(step.edge.id);
        uncertainDynamic.push(
          asNode(
            step.node.path,
            `Uncertain/dynamic: ${step.edge.kind} ${step.edge.specifier}`,
            step.edge.confidence ?? 'heuristic',
            step.node.symbolId,
            step.node.name
          )
        );
      }
    }
  }

  // Exported symbols on seed file
  const seedPath =
    options.target.path ??
    (options.target.symbolId
      ? options.store.getSymbol(options.target.symbolId)?.path
      : undefined);
  if (seedPath) {
    const norm = seedPath.replace(/\\/g, '/');
    for (const sym of options.store.allSymbols()) {
      if (sym.path.replace(/\\/g, '/') !== norm) continue;
      if (sym.exported) {
        const key = sym.id;
        if (!seen.pub.has(key)) {
          seen.pub.add(key);
          publicInterfaces.push(
            asNode(sym.path, 'Exported symbol on target file', 'high', sym.id, sym.name)
          );
        }
      }
    }
  }

  let applicableRules: ChangeImpactReport['applicableRules'] = [];
  try {
    const resolver = await createInstructionResolver({
      workspaceRoot: options.workspaceRoot,
    });
    const files = new Set<string>();
    if (seedPath) files.add(seedPath.replace(/\\/g, '/'));
    for (const p of downstream.slice(0, 6)) {
      for (const s of p.steps) files.add(s.node.path);
    }
    const byId = new Map<string, ChangeImpactReport['applicableRules'][number]>();
    for (const file of files) {
      const instr = await resolver.getApplicableInstructions(file);
      for (const i of instr.slice(0, 8)) {
        if (byId.has(i.id)) continue;
        byId.set(i.id, {
          id: i.id,
          text: i.text,
          sourceFile: i.sourceFile,
          startLine: i.startLine,
          endLine: i.endLine,
          binding: i.binding,
        });
      }
    }
    applicableRules = [...byId.values()];
  } catch {
    applicableRules = [];
  }

  return {
    target: options.target,
    workspaceRoot: options.workspaceRoot,
    directlyAffected,
    likelyDownstream: downstream,
    relatedTests,
    publicInterfaces,
    externalIntegrations,
    applicableRules,
    uncertainDynamic,
    notes: [
      'Likely impact based on the local index; not a guarantee.',
      'Dynamic imports, reflection, and runtime wiring may omit or overstate dependents.',
    ],
  };
}
