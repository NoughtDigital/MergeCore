import type { ProjectProfile } from '@mergecore/intelligence';
import type { ReviewLevelId } from './review-levels';
import type { ReviewPersonaId } from './review-personas';

export type Severity = 'critical' | 'error' | 'warning' | 'info' | 'hint';

export interface Finding {
  readonly id: string;
  readonly severity: Severity;
  readonly message: string;
  readonly whyItMatters?: string;
  readonly fixHint?: string;
  readonly file?: string;
  readonly line?: number;
  readonly column?: number;
  readonly category?: string;
  readonly code?: string;
  /**
   * Short, lower-cased signal word (e.g. "silently", "implicit cast", "swallows
   * errors") extracted by the teaching-enforcement pass when the finding's
   * prose hints at a hidden side effect. The UI surfaces this as a dedicated
   * "Hidden side effect" line so readers cannot miss it during review —
   * hidden effects are the most expensive thing to discover at runtime and
   * the hardest to explain to a new teammate.
   * Undefined when no signal was detected.
   */
  readonly sideEffectSignal?: string;
  /**
   * Human-friendly explanation attached when the teaching audit flags a
   * critical/error/warning finding that ships without a substantive
   * why_it_matters. The extension renders this below the finding in a
   * neutral tone (not a second criticism) so readers know the missing
   * explanation was detected, not silently hidden.
   * Undefined for findings that passed the teaching audit.
   */
  readonly teachingGap?: string;
}

/** Line ranges in the suggested full-file rewrite (1-based, inclusive). */
export interface RewriteAmend {
  readonly startLine: number;
  readonly endLine: number;
  readonly label?: string;
  readonly rationale: string;
}

/** Changes that belong in other files; never applied by “Apply improved code”. */
export interface CrossFileImpact {
  readonly path: string;
  readonly rationale: string;
  readonly suggestedChange?: string;
}

export type ReviewScope = 'selection' | 'file' | 'git-diff';

export interface RelatedContextFile {
  /** Workspace-relative path. */
  readonly path: string;
  /** Why this file was selected for the review context. */
  readonly reason: string;
  /** Bounded, evidence-bearing excerpt from the file. */
  readonly excerpt: string;
}

export interface ReviewRelatedContext {
  readonly strategy: string;
  readonly files: readonly RelatedContextFile[];
  readonly notes?: readonly string[];
  readonly totalExcerptChars: number;
}

export interface ReviewRequest {
  readonly scope: ReviewScope;
  readonly workspaceRoot: string | undefined;
  /** Workspace fingerprint used to select and tune rules packs. */
  readonly projectProfile?: ProjectProfile;
  /** Bounded related files collected before review so findings can follow system effects. */
  readonly relatedContext?: ReviewRelatedContext;
  readonly filePath: string;
  readonly languageId: string;
  readonly label: string;
  readonly content: string;
  readonly selectionSnippet?: string;
  /**
   * Reviewer persona chosen by the user. Applied on top of whichever pack(s)
   * the API selects from projectProfile — pack-agnostic by design.
   */
  readonly reviewerPersonaId?: ReviewPersonaId;
  /**
   * Review level (Quick / File / Flow / PR / Disaster). Pack-agnostic lens
   * that tunes prompt emphasis and triage breadth on top of the persona.
   * Levels never replace the persona; the server layers them.
   */
  readonly reviewLevelId?: ReviewLevelId;
}

export interface ReviewResult {
  readonly findings: readonly Finding[];
  readonly score: number;
  readonly summary?: string;
  readonly improvedCode?: string;
  /** Short overview of why a rewrite is offered (optional). */
  readonly rewriteSummary?: string;
  /** Explains each changed region inside improvedCode. */
  readonly rewriteAmends?: readonly RewriteAmend[];
  /** Follow-up work in other paths; host must not auto-apply these. */
  readonly crossFileImpacts?: readonly CrossFileImpact[];
  readonly patch?: string;
}
