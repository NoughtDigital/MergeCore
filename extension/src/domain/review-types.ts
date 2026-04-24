import type { ProjectProfile } from '@mergecore/intelligence';

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
