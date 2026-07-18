import type {
  DependencyEdge,
  EdgeConfidence,
  RelationshipPath,
  TraverseWeightProfile,
} from '../../contracts/types';
import { isDeterministicEdgeResolution } from '../../contracts/types';
import { confidenceRank } from './budget';

export function isTestPath(p: string): boolean {
  const n = p.replace(/\\/g, '/');
  return (
    /\.(test|spec)\./i.test(n) ||
    /\/__tests__\//i.test(n) ||
    /\/tests?\//i.test(n)
  );
}

export function isEntryPointPath(p: string, name?: string): boolean {
  const n = p.replace(/\\/g, '/').toLowerCase();
  if (
    /\/(controllers?|routes?|http|handlers?|api)\//i.test(n) ||
    /\/(main|index|app|server)\.(ts|js|php)$/i.test(n)
  ) {
    return true;
  }
  if (name && /Controller$|Handler$|Route$/.test(name)) {
    return true;
  }
  return false;
}

export function isIntegrationSpecifier(specifier: string): boolean {
  const s = specifier.toLowerCase();
  return (
    /stripe|twilio|sendgrid|openai|anthropic|aws-sdk|@aws-sdk|paypal|braintree|sentry|segment/.test(
      s
    ) || s.startsWith('http://') || s.startsWith('https://')
  );
}

export function edgeIsDeterministic(edge: DependencyEdge | undefined): boolean {
  if (!edge) return true;
  if (edge.resolutionMethod && isDeterministicEdgeResolution(edge.resolutionMethod)) {
    return true;
  }
  if (edge.confidence === 'certain' || edge.confidence === 'high') {
    return true;
  }
  if (edge.confidence === 'heuristic' || edge.confidence === 'low') {
    return false;
  }
  return edge.resolutionMethod !== 'heuristic' && edge.resolutionMethod !== 'unresolved';
}

/**
 * Rank a path: deterministic first, shorter paths, entry points, tests,
 * integrations, heuristic last.
 */
export function scoreRelationshipPath(
  path: RelationshipPath,
  profile: TraverseWeightProfile = 'default'
): { score: number; reasons: string[] } {
  const reasons: string[] = [];
  let score = 100;

  const hops = Math.max(0, path.steps.length - 1);
  score -= hops * 8;
  reasons.push(`length:${hops}`);

  if (path.deterministic) {
    score += 40;
    reasons.push('deterministic');
  } else {
    score -= 25;
    reasons.push('heuristic');
  }

  const minConf = path.steps
    .map((s) => s.edge?.confidence)
    .filter(Boolean)
    .map((c) => confidenceRank(c as EdgeConfidence));
  if (minConf.length > 0) {
    const worst = Math.min(...minConf);
    score += worst * 4;
  }

  const hasEntry = path.steps.some((s) =>
    isEntryPointPath(s.node.path, s.node.name)
  );
  const hasTest = path.steps.some(
    (s) =>
      isTestPath(s.node.path) ||
      s.edge?.kind === 'likelyTestCoverage'
  );
  const hasIntegration = path.steps.some(
    (s) =>
      s.edge?.kind === 'integration' ||
      (s.edge?.specifier !== undefined && isIntegrationSpecifier(s.edge.specifier))
  );
  const hasRoute = path.steps.some(
    (s) => s.edge?.kind === 'route' || s.edge?.specifier?.startsWith('route:')
  );

  if (profile === 'entry' || profile === 'default' || profile === 'impact') {
    if (hasEntry) {
      score += 18;
      reasons.push('entry-point');
    }
    if (hasRoute) {
      score += 16;
      reasons.push('route');
    }
  }
  if (profile === 'tests' || profile === 'default' || profile === 'impact') {
    if (hasTest) {
      score += 22;
      reasons.push('related-test');
    }
  }
  if (profile === 'impact' || profile === 'default') {
    if (hasIntegration) {
      score += 14;
      reasons.push('integration-boundary');
    }
  }

  if (path.cycleClosed) {
    score -= 10;
    reasons.push('cycle-closed');
  }

  return { score, reasons };
}

export function formatRelationshipPathLabel(path: RelationshipPath): string {
  return path.steps
    .map((s) => s.node.name ?? s.node.path.split('/').pop() ?? s.node.path)
    .join(' → ');
}
