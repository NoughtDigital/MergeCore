import { createSourceReference } from '../../attribution/index';
import type {
  DependencyEdge,
  DependencyEdgeKind,
  RelationshipPath,
  RelationshipPathStep,
  TraverseBudget,
} from '../../contracts/types';
import { sha256 } from '../../rag/hash';
import type { RagStore } from '../../rag/store';
import {
  meetsMinConfidence,
  mergeTraverseBudget,
} from './budget';
import {
  edgeIsDeterministic,
  isEntryPointPath,
  isIntegrationSpecifier,
  isTestPath,
  scoreRelationshipPath,
} from './rank';

export interface TraverseStart {
  readonly symbolId?: string;
  readonly path?: string;
}

export interface TraverseRelationshipPathsOptions {
  readonly store: RagStore;
  readonly start: TraverseStart;
  readonly budget?: TraverseBudget;
  readonly workspaceId?: string;
}

interface QueueItem {
  readonly nodeKey: string;
  readonly symbolId?: string;
  readonly path: string;
  readonly name?: string;
  readonly kind?: string;
  readonly depth: number;
  readonly steps: readonly RelationshipPathStep[];
  readonly pathNodeKeys: ReadonlySet<string>;
  readonly priority: number;
}

function normalise(p: string): string {
  return p.replace(/\\/g, '/');
}

function nodeKey(symbolId: string | undefined, path: string): string {
  return symbolId ? `sym:${symbolId}` : `file:${normalise(path)}`;
}

function effectiveKind(edge: DependencyEdge): DependencyEdgeKind {
  if (edge.kind === 'fileDependency' && edge.specifier.startsWith('route:')) {
    return 'route';
  }
  if (edge.specifier.startsWith('route:') && edge.kind !== 'route') {
    return 'route';
  }
  if (
    (edge.kind === 'import' || edge.kind === 'require') &&
    isIntegrationSpecifier(edge.specifier)
  ) {
    return 'integration';
  }
  return edge.kind;
}

function edgePriority(edge: DependencyEdge): number {
  let p = 0;
  if (edgeIsDeterministic(edge)) p += 50;
  p += (edge.confidence === 'certain' ? 20 : edge.confidence === 'high' ? 15 : edge.confidence === 'medium' ? 8 : 0);
  const k = effectiveKind(edge);
  if (k === 'call') p += 12;
  if (k === 'route') p += 14;
  if (k === 'likelyTestCoverage') p += 10;
  if (k === 'import' || k === 'require') p += 6;
  if (k === 'extends' || k === 'implements' || k === 'typeUsage') p += 8;
  if (edge.confidence === 'heuristic') p -= 20;
  return p;
}

function evidenceForEdge(
  workspaceId: string,
  edge: DependencyEdge
): RelationshipPathStep['evidence'] {
  const line = edge.startLine ?? 1;
  return [
    createSourceReference({
      workspaceId,
      path: edge.fromPath,
      startLine: line,
      endLine: edge.endLine ?? line,
      sourceType: 'dependency',
      symbolId: edge.fromSymbol,
      extraction: edgeIsDeterministic(edge) ? 'deterministic' : 'heuristic',
      excerpt: edge.evidence?.[0] ?? `${edge.kind} ${edge.specifier}`,
    }),
  ];
}

function seedStep(
  workspaceId: string,
  store: RagStore,
  start: TraverseStart
): RelationshipPathStep | undefined {
  if (start.symbolId) {
    const sym = store.getSymbol(start.symbolId);
    if (sym) {
      return {
        node: {
          symbolId: sym.id,
          name: sym.name,
          path: normalise(sym.path),
          kind: sym.kind,
        },
        evidence: [
          createSourceReference({
            workspaceId,
            path: sym.path,
            startLine: sym.startLine,
            endLine: sym.endLine,
            sourceType: 'symbol',
            symbolId: sym.id,
            symbol: sym.name,
            extraction: 'deterministic',
          }),
        ],
      };
    }
  }
  if (start.path) {
    const p = normalise(start.path);
    const file = store.getFile(p);
    return {
      node: { path: p, name: p.split('/').pop() },
      evidence: [
        createSourceReference({
          workspaceId,
          path: p,
          startLine: 1,
          endLine: 1,
          sourceType: 'source',
          sourceFingerprint: file?.hash,
          extraction: 'deterministic',
        }),
      ],
    };
  }
  return undefined;
}

function collectIncidentEdges(
  store: RagStore,
  item: QueueItem,
  direction: TraverseBudget['direction']
): DependencyEdge[] {
  const edges: DependencyEdge[] = [];
  const seen = new Set<string>();
  const push = (e: DependencyEdge): void => {
    if (seen.has(e.id)) return;
    seen.add(e.id);
    edges.push(e);
  };

  if (item.symbolId) {
    for (const e of store.edgesForSymbol(item.symbolId)) {
      push(e);
    }
  }
  for (const e of store.edgesFrom(item.path)) push(e);
  for (const e of store.edgesTo(item.path)) push(e);

  return edges.filter((e) => {
    const fromSym = e.fromSymbol;
    const toSym = e.toSymbol;
    const fromPath = normalise(e.fromPath);
    const toPath = normalise(e.toPath);
    const atFrom =
      (item.symbolId && fromSym === item.symbolId) || fromPath === item.path;
    const atTo =
      (item.symbolId && toSym === item.symbolId) || toPath === item.path;

    if (direction === 'outgoing') return atFrom;
    if (direction === 'incoming') return atTo;
    return atFrom || atTo;
  });
}

function nextEndpoint(
  edge: DependencyEdge,
  item: QueueItem,
  direction: TraverseBudget['direction']
): { symbolId?: string; path: string } | undefined {
  const fromPath = normalise(edge.fromPath);
  const toPath = normalise(edge.toPath);
  const atFrom =
    (item.symbolId && edge.fromSymbol === item.symbolId) || fromPath === item.path;
  const atTo =
    (item.symbolId && edge.toSymbol === item.symbolId) || toPath === item.path;

  if (direction === 'outgoing' || (direction === 'both' && atFrom && !atTo)) {
    return { symbolId: edge.toSymbol, path: toPath };
  }
  if (direction === 'incoming' || (direction === 'both' && atTo && !atFrom)) {
    return { symbolId: edge.fromSymbol, path: fromPath };
  }
  if (direction === 'both' && atFrom) {
    return { symbolId: edge.toSymbol, path: toPath };
  }
  if (direction === 'both' && atTo) {
    return { symbolId: edge.fromSymbol, path: fromPath };
  }
  return undefined;
}

function shouldStop(
  step: RelationshipPathStep,
  stopWhen: TraverseBudget['stopWhen']
): boolean {
  if (!stopWhen) return false;
  if (stopWhen.hitEntryPoint && isEntryPointPath(step.node.path, step.node.name)) {
    return true;
  }
  if (
    stopWhen.hitTest &&
    (isTestPath(step.node.path) || step.edge?.kind === 'likelyTestCoverage')
  ) {
    return true;
  }
  if (
    stopWhen.hitIntegration &&
    (step.edge?.kind === 'integration' ||
      (step.edge?.specifier && isIntegrationSpecifier(step.edge.specifier)))
  ) {
    return true;
  }
  if (stopWhen.hitInstruction && step.edge?.kind === 'documentation') {
    return true;
  }
  return false;
}

/**
 * Budgeted priority traversal that reconstructs full relationship paths
 * with per-hop evidence. Cycles are closed without further expansion.
 */
export function traverseRelationshipPaths(
  options: TraverseRelationshipPathsOptions
): readonly RelationshipPath[] {
  const budget = mergeTraverseBudget(options.budget);
  const store = options.store;
  const workspaceId =
    options.workspaceId ?? store.getFile(options.start.path ?? '')?.workspaceId ?? 'local';

  const seed = seedStep(workspaceId, store, options.start);
  if (!seed) {
    return [];
  }

  const kindSet = budget.kinds ? new Set(budget.kinds) : undefined;
  const paths: RelationshipPath[] = [];
  const visitedGlobal = new Set<string>();
  let nodesExpanded = 0;

  const seedKey = nodeKey(seed.node.symbolId, seed.node.path);
  visitedGlobal.add(seedKey);

  const queue: QueueItem[] = [
    {
      nodeKey: seedKey,
      symbolId: seed.node.symbolId,
      path: seed.node.path,
      name: seed.node.name,
      kind: seed.node.kind,
      depth: 0,
      steps: [seed],
      pathNodeKeys: new Set([seedKey]),
      priority: 1000,
    },
  ];

  while (queue.length > 0 && paths.length < budget.maxPaths!) {
    queue.sort((a, b) => b.priority - a.priority);
    const cur = queue.shift()!;
    nodesExpanded++;
    if (nodesExpanded > budget.maxNodes!) {
      break;
    }

    if (cur.depth >= budget.maxDepth!) {
      // Emit leaf path when we hit depth
      if (cur.steps.length > 1) {
        paths.push(finalisePath(cur.steps, false, budget.weightProfile!));
      }
      continue;
    }

    let edges = collectIncidentEdges(store, cur, budget.direction);
    if (kindSet) {
      edges = edges.filter((e) => {
        const k = effectiveKind(e);
        return kindSet.has(k) || kindSet.has(e.kind);
      });
    }
    edges = edges.filter((e) =>
      meetsMinConfidence(e.confidence, budget.minConfidence)
    );

    // Hub truncation
    const degree = edges.length;
    if (degree > (budget.hubDegreeTruncate ?? 40)) {
      edges = [...edges]
        .sort((a, b) => edgePriority(b) - edgePriority(a))
        .slice(0, budget.maxFanOutPerNode);
    } else {
      edges = [...edges]
        .sort((a, b) => edgePriority(b) - edgePriority(a))
        .slice(0, budget.maxFanOutPerNode);
    }

    let expanded = 0;
    for (const edge of edges) {
      if (paths.length >= budget.maxPaths!) break;
      const next = nextEndpoint(edge, cur, budget.direction);
      if (!next) continue;

      const nextPath = normalise(next.path);
      const nextKey = nodeKey(next.symbolId, nextPath);
      const cycleClosed = cur.pathNodeKeys.has(nextKey);

      const sym = next.symbolId ? store.getSymbol(next.symbolId) : undefined;
      const step: RelationshipPathStep = {
        node: {
          symbolId: next.symbolId ?? sym?.id,
          name: sym?.name ?? nextPath.split('/').pop(),
          path: nextPath,
          kind: sym?.kind,
        },
        edge: { ...edge, kind: effectiveKind(edge) },
        evidence: evidenceForEdge(workspaceId, edge),
      };

      const nextSteps = [...cur.steps, step];
      if (cycleClosed) {
        paths.push(finalisePath(nextSteps, true, budget.weightProfile!));
        continue;
      }

      if (shouldStop(step, budget.stopWhen) && nextSteps.length > 1) {
        paths.push(finalisePath(nextSteps, false, budget.weightProfile!));
        continue;
      }

      // Allow revisiting globally only for alternate paths with remaining budget
      if (visitedGlobal.has(nextKey) && cur.depth + 1 > 1) {
        // Still record a short path ending here once
        if (nextSteps.length > 1 && paths.length < budget.maxPaths!) {
          paths.push(finalisePath(nextSteps, false, budget.weightProfile!));
        }
        continue;
      }

      visitedGlobal.add(nextKey);
      const nextKeys = new Set(cur.pathNodeKeys);
      nextKeys.add(nextKey);

      queue.push({
        nodeKey: nextKey,
        symbolId: next.symbolId,
        path: nextPath,
        name: step.node.name,
        kind: step.node.kind,
        depth: cur.depth + 1,
        steps: nextSteps,
        pathNodeKeys: nextKeys,
        priority: cur.priority + edgePriority(edge) - (cur.depth + 1) * 5,
      });
      expanded++;

      // Emit intermediate useful paths (entry/test/integration)
      if (
        nextSteps.length > 1 &&
        (isEntryPointPath(step.node.path, step.node.name) ||
          isTestPath(step.node.path) ||
          step.edge?.kind === 'likelyTestCoverage' ||
          step.edge?.kind === 'route' ||
          step.edge?.kind === 'integration')
      ) {
        paths.push(finalisePath(nextSteps, false, budget.weightProfile!));
      }
    }

    // If no expansion from a multi-hop node, keep the path
    if (expanded === 0 && cur.steps.length > 1) {
      paths.push(finalisePath(cur.steps, false, budget.weightProfile!));
    }
  }

  return dedupeAndRank(paths, budget.maxPaths!);
}

function finalisePath(
  steps: readonly RelationshipPathStep[],
  cycleClosed: boolean,
  profile: NonNullable<TraverseBudget['weightProfile']>
): RelationshipPath {
  const deterministic = steps.every((s) => edgeIsDeterministic(s.edge));
  const worstConf = steps
    .map((s) => s.edge?.confidence)
    .filter((c): c is NonNullable<typeof c> => Boolean(c))
    .sort((a, b) => confidenceOrd(a) - confidenceOrd(b))[0];

  const draft: RelationshipPath = {
    id: pathId(steps),
    steps,
    score: 0,
    reasons: [],
    confidence: worstConf ?? (deterministic ? 'high' : 'heuristic'),
    deterministic,
    cycleClosed: cycleClosed || undefined,
  };
  const scored = scoreRelationshipPath(draft, profile);
  return {
    ...draft,
    score: scored.score,
    reasons: [
      ...scored.reasons,
      ...(cycleClosed ? (['cycle-closed'] as const) : []),
    ],
  };
}

function confidenceOrd(c: string): number {
  const order: Record<string, number> = {
    heuristic: 1,
    low: 2,
    medium: 3,
    high: 4,
    certain: 5,
  };
  return order[c] ?? 3;
}

function pathId(steps: readonly RelationshipPathStep[]): string {
  const key = steps
    .map(
      (s) =>
        `${s.node.symbolId ?? s.node.path}:${s.edge?.kind ?? 'seed'}:${s.edge?.id ?? ''}`
    )
    .join('|');
  return `path:${sha256(key).slice(0, 16)}`;
}

function dedupeAndRank(
  paths: readonly RelationshipPath[],
  maxPaths: number
): RelationshipPath[] {
  const byId = new Map<string, RelationshipPath>();
  for (const p of paths) {
    const existing = byId.get(p.id);
    if (!existing || p.score > existing.score) {
      byId.set(p.id, p);
    }
  }
  // Also dedupe by step signature (same nodes)
  const bySig = new Map<string, RelationshipPath>();
  for (const p of byId.values()) {
    const sig = p.steps.map((s) => s.node.symbolId ?? s.node.path).join('>');
    const existing = bySig.get(sig);
    if (!existing || p.score > existing.score) {
      bySig.set(sig, p);
    }
  }
  return [...bySig.values()]
    .sort((a, b) => b.score - a.score || a.steps.length - b.steps.length)
    .slice(0, maxPaths);
}
