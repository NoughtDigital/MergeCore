/**
 * Prompt assembly for the LLM stage. Deterministic rules are merged server-side;
 * the model must not contradict grounded rule hits on severity for the same evidence.
 */

import { getPersonaById, type ReviewPersonaId } from './personas.js';
import { getReviewLevelById, type ReviewLevelId } from './review-levels.js';

export interface ReviewPromptInput {
  readonly scope: 'selection' | 'file' | 'git-diff';
  readonly filePath: string;
  readonly languageId: string;
  readonly codeOrDiff: string;
  readonly relatedContextDigest?: string;
  readonly projectRulesDigest: string;
  readonly deterministicFindingsJson: string;
  readonly maxFindings: number;
  /**
   * Optional reviewer persona. Tunes emphasis and tone across any pack; never
   * overrides ground rules (schema, evidence, insufficient_context).
   */
  readonly reviewerPersonaId?: ReviewPersonaId;
  /**
   * Optional review level (quick, file, flow, pr, disaster). Tunes triage
   * depth and breadth on top of the persona; never overrides ground rules.
   */
  readonly reviewLevelId?: ReviewLevelId;
}

const SYSTEM = `You are MergeCore, a stack-aware code reviewer. You MUST respond with a single JSON object that conforms exactly to the provided JSON Schema (schema_version "1.0"). UK English in all prose fields.

Ground rules:
1. Hallucination control: Every finding MUST include evidence.snippet copied verbatim from the reviewed input or the auto-scanned related project context. If you cannot quote verbatim evidence, omit the finding.
2. Do not invent line numbers: set start_line/end_line only when you can map snippet to input lines; otherwise null with kind "file_level" only when the issue applies to the whole input.
3. Do not claim packages, migrations, or files exist outside the reviewed input or auto-scanned related project context.
4. Prefer fewer, higher-confidence findings over many weak ones (cap enforced by maxFindings).
5. Apply the active project rules digest and stack signals. If the reviewed input and auto-scanned context are not covered by the supplied packs or are too small to judge, set insufficient_context to true, findings to [], score to 5, and explain the limitation in summary (schema requires a numeric score).
6. Merge behaviour: deterministic_rule_hits and deterministic findings JSON are authoritative for rule_id and titles where they overlap. You may add at most a small number of additional findings if strongly evidenced.
7. suggested_rewrite and patch: produce only when the reviewed scope is self-contained AND you can supply a safe full replacement or unified diff. Otherwise set both to null. Never include secrets or credentials.
8. why_it_matters must be specific to the active language/framework pack's maintainability, security, performance, operability, or correctness concerns — no generic advice.`;

export function buildSystemPrompt(
  personaId?: ReviewPersonaId,
  levelId?: ReviewLevelId
): string {
  const persona = getPersonaById(personaId);
  const level = getReviewLevelById(levelId);
  const parts: string[] = [SYSTEM];

  if (persona.id !== 'auto') {
    parts.push(
      `Reviewer persona: ${persona.title}
${persona.promptInstruction}
Persona emphasis MUST NOT override the ground rules above: never invent evidence, never alter the schema, and still set insufficient_context=true when the input is not covered by the supplied packs.`
    );
  }

  // Every review runs at some level; the default (file) is an intentional
  // no-op emphasis, but we still surface it so the prompt is consistent
  // between requests and future levels plug in without a code change here.
  parts.push(
    `Review level: ${level.title}
${level.promptInstruction}
Review-level emphasis MUST NOT override the ground rules above and MUST NOT replace the reviewer persona; it layers on top. Never invent evidence, never alter the schema.`
  );

  return parts.join('\n\n');
}

export function buildUserPrompt(input: ReviewPromptInput): string {
  const level = getReviewLevelById(input.reviewLevelId);
  const header =
    input.scope === 'git-diff'
      ? 'Review the following git diff as a stack-aware code change.'
      : 'Review the following code with the applicable MergeCore pack(s).';

  return `${header}

File path: ${input.filePath}
Language: ${input.languageId}
Scope: ${input.scope}
Review level: ${level.id}
Max findings: ${input.maxFindings}

--- Project rules digest (compressed ids and titles; obey when relevant) ---
${input.projectRulesDigest}

--- Deterministic engine output (JSON; authoritative for overlapping issues) ---
${input.deterministicFindingsJson}

${input.relatedContextDigest ? `--- Auto-scanned related project context ---
${input.relatedContextDigest}

` : ''}
--- Input to review ---
${input.codeOrDiff}
--- End input ---

Return JSON only. Score must reflect both severity of evidenced issues and positive signals (tests, typing, safe queries) only when evidenced in the reviewed input or auto-scanned context.`;
}
