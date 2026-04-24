/**
 * Review levels surfaced in the extension UI.
 *
 * The authoritative level definitions and prompt instructions live server-side
 * in engine/pipeline/review-levels.ts. The extension only needs the ids and
 * presentation strings. Keep the id list in sync with the engine module —
 * the id is the only wire contract.
 *
 * Adding a new level is intentionally a two-file change (engine + extension)
 * so the server contract and the UI stay aligned; neither side should
 * silently accept a level the other does not know about.
 */

export type ReviewLevelId =
  | 'quick'
  | 'file'
  | 'flow'
  | 'pr'
  | 'disaster';

export interface ReviewLevel {
  readonly id: ReviewLevelId;
  /** Short label used in UI buttons and the command palette. */
  readonly title: string;
  /** Plain-English explanation shown in the button tooltip / hover. */
  readonly tagline: string;
  /** 2–5 word badge shown in the sidebar header when this level was used. */
  readonly badge: string;
  /**
   * Preferred editor scope when the level is invoked. Used by the host to
   * pick the right scope resolver (selection vs file vs git-diff).
   */
  readonly preferredScope: 'selection' | 'file' | 'git-diff';
  /** Optional context-menu order; lower = earlier. */
  readonly order: number;
}

const LEVEL_LIST: readonly ReviewLevel[] = [
  {
    id: 'quick',
    title: 'Quick Review',
    tagline: 'Current function only. Fast, focused sanity check.',
    badge: 'Quick',
    preferredScope: 'selection',
    order: 1,
  },
  {
    id: 'file',
    title: 'File Review',
    tagline: 'Current file end-to-end.',
    badge: 'File',
    preferredScope: 'file',
    order: 2,
  },
  {
    id: 'flow',
    title: 'Flow Review',
    tagline: 'Linked files + business process.',
    badge: 'Flow',
    preferredScope: 'file',
    order: 3,
  },
  {
    id: 'pr',
    title: 'PR Review',
    tagline: 'Changed files + impact analysis.',
    badge: 'PR',
    preferredScope: 'git-diff',
    order: 4,
  },
  {
    id: 'disaster',
    title: 'Disaster Review',
    tagline: 'Find everything wrong. Broad, unsparing sweep.',
    badge: 'Disaster',
    preferredScope: 'file',
    order: 5,
  },
];

const LEVEL_BY_ID: Readonly<Record<ReviewLevelId, ReviewLevel>> = Object.freeze(
  LEVEL_LIST.reduce<Record<ReviewLevelId, ReviewLevel>>((acc, lvl) => {
    acc[lvl.id] = lvl;
    return acc;
  }, {} as Record<ReviewLevelId, ReviewLevel>)
);

export const REVIEW_LEVELS: readonly ReviewLevel[] = [...LEVEL_LIST].sort(
  (a, b) => a.order - b.order
);

export const DEFAULT_REVIEW_LEVEL_ID: ReviewLevelId = 'file';

export function isReviewLevelId(value: string): value is ReviewLevelId {
  return Object.prototype.hasOwnProperty.call(LEVEL_BY_ID, value);
}

export function getReviewLevelById(id: string | undefined | null): ReviewLevel {
  if (typeof id === 'string' && isReviewLevelId(id)) {
    return LEVEL_BY_ID[id];
  }
  return LEVEL_BY_ID[DEFAULT_REVIEW_LEVEL_ID];
}

/**
 * Maps a level id to the VS Code command that runs it. Keeping this in the
 * domain module (not the command registrar) means the sidebar, the context
 * menu, the status bar and future surfaces all agree on the command ids
 * without importing presentation code.
 */
export function commandIdForReviewLevel(id: ReviewLevelId): string {
  return `mergecore.review.${id}`;
}
