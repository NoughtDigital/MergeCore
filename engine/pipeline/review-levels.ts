/**
 * Review levels: a pack-agnostic lens on top of `scope`.
 *
 * `scope` (selection | file | git-diff) is the wire-level shape the pipeline
 * sees and has always seen. A `ReviewLevel` is a higher-level user intent —
 * "quick function-only pass", "flow through the system", "disaster hunt" —
 * that tunes prompt emphasis and triage without touching the schema.
 *
 * The registry is the single source of truth. Adding a new level (e.g.
 * "release-review", "hotfix") is one entry here plus a matching host scope
 * resolver. Packs never need to know levels exist.
 *
 * Levels NEVER override ground rules (schema, evidence, insufficient_context)
 * and NEVER replace the active reviewer persona: they layer on top and the
 * final prompt is base + persona + level.
 */

export type ReviewLevelId =
  | 'quick'
  | 'file'
  | 'flow'
  | 'pr'
  | 'disaster';

export interface ReviewLevel {
  readonly id: ReviewLevelId;
  /** Short label used in UI buttons and command palette. */
  readonly title: string;
  /** One-line summary used under the button / in hover. */
  readonly tagline: string;
  /** 2–5 word badge for the sidebar header chip. */
  readonly badge: string;
  /**
   * Preferred editor scope when the level is invoked. Hosts may override
   * (e.g. Flow without an active editor could fall back to file).
   */
  readonly preferredScope: 'selection' | 'file' | 'git-diff';
  /**
   * Prompt emphasis block appended to the system prompt. Must not contradict
   * ground rules; tunes weighting and what findings to surface first.
   */
  readonly promptInstruction: string;
  /**
   * Suggested cap on findings. The engine still clamps to the quota;
   * this is a hint so `disaster` can expand and `quick` can contract.
   */
  readonly maxFindingsHint: number;
}

const LEVEL_LIST: readonly ReviewLevel[] = [
  {
    id: 'quick',
    title: 'Quick Review',
    tagline: 'Current function only. Fast, focused sanity check.',
    badge: 'Quick',
    preferredScope: 'selection',
    promptInstruction:
      'Quick-review lens: treat the input as a single function or small routine. Prioritise local correctness, obvious bugs, input handling at this function boundary, and immediate readability. Do not speculate about callers or surrounding modules unless the evidence is visible in the input.',
    maxFindingsHint: 8,
  },
  {
    id: 'file',
    title: 'File Review',
    tagline: 'Current file end-to-end.',
    badge: 'File',
    preferredScope: 'file',
    promptInstruction:
      'File-review lens: review the whole file as a cohesive unit. Weight findings toward file-level concerns (exports, public surface, invariants across functions, internal duplication, testability of the module). Treat anything outside the file as out of scope unless referenced in the auto-scanned related context.',
    maxFindingsHint: 15,
  },
  {
    id: 'flow',
    title: 'Flow Review',
    tagline: 'Linked files + business process.',
    badge: 'Flow',
    preferredScope: 'file',
    promptInstruction:
      'Flow-review lens: trace the business process that runs through this file using the auto-scanned related context (routes, entrypoints, services, schema, tests). Prioritise findings that break the flow: contract drift between caller and callee, transactions/retries, partial-failure handling, authorisation at boundaries, data shape mismatches, and tests that would have caught it. Never claim a cross-file change exists if evidence is not in the related context.',
    maxFindingsHint: 18,
  },
  {
    id: 'pr',
    title: 'PR Review',
    tagline: 'Changed files + impact analysis.',
    badge: 'PR',
    preferredScope: 'git-diff',
    promptInstruction:
      'PR-review lens: treat the diff as the change under review. For every non-trivial hunk, reason about impact: what behaviour changes, what invariants might break, what tests or migrations are missing, what backwards-compatibility risks the change introduces, and whether the change is reversible. Use the related context to check for callers or schema affected by the change. Do not flag code that the diff does not touch.',
    maxFindingsHint: 20,
  },
  {
    id: 'disaster',
    title: 'Disaster Review',
    tagline: 'Find everything wrong. Broad, unsparing sweep.',
    badge: 'Disaster',
    preferredScope: 'file',
    promptInstruction:
      'Disaster-review lens: do a broad, unsparing sweep. Enumerate every evidenced issue across correctness, security, concurrency, performance, operability, maintainability, tests and documentation — up to the findings cap. Reserve critical/error for issues with exploit, data-loss or outage potential. Still obey evidence rules: every finding must cite verbatim snippet; speculation without evidence must be dropped, not softened.',
    maxFindingsHint: 25,
  },
];

const LEVEL_BY_ID: Readonly<Record<ReviewLevelId, ReviewLevel>> = Object.freeze(
  LEVEL_LIST.reduce<Record<ReviewLevelId, ReviewLevel>>((acc, lvl) => {
    acc[lvl.id] = lvl;
    return acc;
  }, {} as Record<ReviewLevelId, ReviewLevel>)
);

export const REVIEW_LEVELS: readonly ReviewLevel[] = LEVEL_LIST;

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
