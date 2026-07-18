import type { ProjectConvention } from '../types';

/** Rival ids for “where does domain work live?” — only one should dominate critiques. */
export const LAYERING_RIVAL_IDS = [
  'arch:actions-pattern',
  'layering:services-over-helpers',
  'arch:commands-and-handlers',
] as const;

export type LayeringRivalId = (typeof LAYERING_RIVAL_IDS)[number];

const CONFIDENCE_WEIGHT: Record<ProjectConvention['confidence'], number> = {
  high: 3,
  medium: 2,
  low: 1,
};

/** Minimal shape shared with pipeline digests. */
export interface ConventionLike {
  readonly id: string;
  readonly label: string;
  readonly confidence: 'high' | 'medium' | 'low';
  readonly category: string;
  readonly evidence?: readonly string[];
}

export interface SuppressedConvention<T extends ConventionLike = ProjectConvention> {
  readonly convention: T;
  readonly reason: string;
  readonly dominatedBy: string;
}

export interface ConventionConflictResolution<T extends ConventionLike = ProjectConvention> {
  readonly activeConventions: readonly T[];
  readonly suppressedConventions: readonly SuppressedConvention<T>[];
  readonly dominantLayeringId?: string;
}

/**
 * Rank layering/command-style rivals by evidence count × confidence and
 * suppress losers so mock rules and API prompts do not treat minority
 * patterns as exclusive law.
 *
 * When two medium+ rivals score within ~20%, both stay active (placement
 * checks handle coexistence — not a pattern holy war).
 */
export function resolveConventionConflicts<T extends ConventionLike>(
  conventions: readonly T[]
): ConventionConflictResolution<T> {
  if (conventions.length === 0) {
    return { activeConventions: [], suppressedConventions: [] };
  }

  const rivals = conventions.filter((c): c is T & { id: LayeringRivalId } =>
    (LAYERING_RIVAL_IDS as readonly string[]).includes(c.id)
  );

  if (rivals.length <= 1) {
    return {
      activeConventions: [...conventions],
      suppressedConventions: [],
      dominantLayeringId: rivals[0]?.id,
    };
  }

  const ranked = [...rivals].sort((a, b) => {
    const delta = conventionStrength(b) - conventionStrength(a);
    if (delta !== 0) {
      return delta;
    }
    return a.id.localeCompare(b.id);
  });

  const winner = ranked[0];
  const winnerScore = conventionStrength(winner);
  const keepIds = new Set<string>([winner.id]);

  for (let i = 1; i < ranked.length; i += 1) {
    const rival = ranked[i];
    const rivalScore = conventionStrength(rival);
    const close =
      winnerScore > 0 && rivalScore / winnerScore >= 0.8 && isMediumOrHigher(rival) && isMediumOrHigher(winner);
    if (close) {
      keepIds.add(rival.id);
    }
  }

  const suppressed: SuppressedConvention<T>[] = [];
  const active: T[] = [];

  for (const c of conventions) {
    const isRival = (LAYERING_RIVAL_IDS as readonly string[]).includes(c.id);
    if (!isRival || keepIds.has(c.id)) {
      active.push(c);
      continue;
    }
    suppressed.push({
      convention: c,
      reason: `outvoted by ${winner.id}`,
      dominatedBy: winner.id,
    });
  }

  return {
    activeConventions: active,
    suppressedConventions: suppressed,
    dominantLayeringId: winner.id,
  };
}

export function conventionStrength(c: ConventionLike): number {
  return evidenceCount(c) * CONFIDENCE_WEIGHT[c.confidence];
}

function isMediumOrHigher(c: ConventionLike): boolean {
  return c.confidence === 'medium' || c.confidence === 'high';
}

/**
 * Prefer a leading file-count from evidence strings
 * (e.g. "12 service files in Services/") else evidence length, else 1.
 */
function evidenceCount(c: ConventionLike): number {
  const evidence = c.evidence ?? [];
  let maxParsed = 0;
  for (const line of evidence) {
    const m = /^(\d+)\b/.exec(line.trim());
    if (m) {
      maxParsed = Math.max(maxParsed, Number(m[1]));
    }
  }
  if (maxParsed > 0) {
    return maxParsed;
  }
  return Math.max(evidence.length, 1);
}
