import type { ExplanationMode, IntelligenceProfile } from '../../domain/explanation-modes';
import {
  getExplanationMode,
  getIntelligenceProfile,
} from '../../domain/explanation-modes';
import type { OllamaChatMessage } from './ollama.client';
import { auditHoverExplanation } from './hover-quality';

export interface ExplainSymbolInput {
  readonly symbol: string;
  readonly filePath: string;
  readonly code: string;
  readonly mode: ExplanationMode;
  readonly profile?: IntelligenceProfile;
  readonly relatedSummary: string;
  readonly ragContext: string;
  readonly architecturalHints: string;
  readonly signal?: AbortSignal;
}

export interface SymbolExplanation {
  readonly markdown: string;
  readonly source: 'ollama' | 'template';
}

export interface ExplainerPorts {
  readonly chat: (
    messages: readonly OllamaChatMessage[],
    signal?: AbortSignal
  ) => Promise<string | undefined>;
  readonly isAvailable: (signal?: AbortSignal) => Promise<boolean>;
}

const SECTION_HEADERS = [
  'Function Summary',
  'Inputs / Outputs',
  'Pros',
  'Cons / Risks',
  'Related Systems',
  'Architectural Context',
] as const;

/**
 * Builds hover explanations via local Ollama when available, otherwise a
 * deterministic structured template so cognition works offline.
 */
export class Explainer {
  constructor(private readonly ports: ExplainerPorts | undefined) {}

  async explain(input: ExplainSymbolInput): Promise<SymbolExplanation> {
    if (this.ports) {
      const available = await this.ports.isAvailable(input.signal);
      if (available) {
        const mode = getExplanationMode(input.mode);
        const profile = getIntelligenceProfile(input.profile);
        const system = [
          'You are MergeCore, a local engineering cognition layer.',
          'Explain code — do not generate or rewrite code.',
          'Respond in UK English markdown with exactly these level-2 headings in order:',
          SECTION_HEADERS.map((h) => `## ${h}`).join('\n'),
          mode.promptBias,
          profile.promptBias,
          'Keep each section to 2–4 short sentences. Be specific to the supplied code and context.',
          'Never write vague lines like "best practice" or "might cause issues" without naming a concrete cost.',
        ].join('\n');

        const user = [
          `Symbol: ${input.symbol}`,
          `File: ${input.filePath}`,
          `Mode: ${mode.id}`,
          `Profile: ${profile.id}`,
          '',
          'Code:',
          '```php',
          input.code.slice(0, 4000),
          '```',
          '',
          'Related systems:',
          input.relatedSummary || '(none found)',
          '',
          'Repository memory / RAG context:',
          input.ragContext.slice(0, 3500) || '(none)',
          '',
          'Architectural hints:',
          input.architecturalHints || '(none)',
        ].join('\n');

        const content = await this.ports.chat(
          [
            { role: 'system', content: system },
            { role: 'user', content: user },
          ],
          input.signal
        );
        if (content) {
          const audit = auditHoverExplanation(content);
          if (audit.ok) {
            return { markdown: content.trim(), source: 'ollama' };
          }
        }
      }
    }

    return { markdown: buildTemplate(input), source: 'template' };
  }
}

function buildTemplate(input: ExplainSymbolInput): string {
  const mode = getExplanationMode(input.mode);
  const profile = getIntelligenceProfile(input.profile);
  const related =
    input.relatedSummary.trim() ||
    '_No closely linked files detected yet. Index the repository for richer links._';
  const memory = input.ragContext.trim()
    ? truncate(input.ragContext, 600)
    : '_No markdown memory retrieved. Add README.md / decisions.md / agents.md to encode team context._';

  const copy = modeCopy(mode.id, input);
  const profileNote = profile.id === 'default' ? '' : ` Profile lens: ${profile.title} — ${profile.tagline}`;

  return [
    `## Function Summary`,
    copy.summary,
    '',
    `## Inputs / Outputs`,
    copy.io,
    '',
    `## Pros`,
    copy.pros,
    '',
    `## Cons / Risks`,
    copy.cons,
    '',
    `## Related Systems`,
    related,
    '',
    `## Architectural Context`,
    copy.arch + profileNote,
    '',
    `---`,
    `_Mode: ${mode.title}. Memory excerpt: ${memory}_`,
  ].join('\n');
}

function modeCopy(
  mode: ExplanationMode,
  input: ExplainSymbolInput
): { summary: string; io: string; pros: string; cons: string; arch: string } {
  const sym = `\`${input.symbol}\``;
  const file = `\`${input.filePath}\``;
  switch (mode) {
    case 'junior':
      return {
        summary: `${sym} in ${file} is a unit of behaviour in this codebase. Read the signature and body to see what it does step by step.`,
        io: 'Look at parameters and return types in the snippet. Inputs enter through arguments and request/model objects; outputs leave via return values, side effects, or dispatched jobs.',
        pros: 'Keeping this logic named and local makes it easier to find, test, and explain to teammates.',
        cons: 'Common mistakes: ignoring validation, swallowing errors, or mixing HTTP concerns with domain logic. Watch for anything that surprises callers.',
        arch:
          input.architecturalHints ||
          'Laravel apps often place HTTP in controllers, rules in FormRequests, and work in jobs/services. This pattern keeps each layer focused.',
      };
    case 'mid':
      return {
        summary: `${sym} in ${file} sits in the delivery workflow — check how maintainable the surrounding flow stays when this changes.`,
        io: 'Map the practical contract: who calls this, what DTO/request shape arrives, and which downstream service/job/model it touches.',
        pros: 'Clear workflow boundaries reduce rewrite cost and keep reviews focused on one responsibility.',
        cons: 'Watch for creeping god-objects, duplicated workflow steps, and weak test seams that slow every subsequent change.',
        arch:
          input.architecturalHints ||
          'Prefer cohesive modules along the business process rather than convenience helpers that blur ownership.',
      };
    case 'senior':
      return {
        summary: `${sym} in ${file} sits on a service boundary — weigh coupling, side effects, and blast radius before changing it.`,
        io: 'Trace inbound contracts (requests, DTOs, events) and outbound effects (persistence, queues, HTTP). Hidden I/O is a maintainability risk.',
        pros: 'A clear symbol boundary helps isolate change and supports targeted tests when responsibilities stay narrow.',
        cons: 'Watch for race conditions, tight coupling to frameworks, scalability cliffs, and operational blind spots (timeouts, retries, idempotency).',
        arch:
          input.architecturalHints ||
          'Prefer explicit boundaries over convenience facades when this path sits on a hot or compliance-sensitive flow.',
      };
    case 'expert':
      return {
        summary: `${sym} in ${file} deserves architectural critique: concurrency, framework philosophy conflicts, and enterprise scaling implications matter here.`,
        io: 'Enumerate every side channel — caches, queues, observers, facades, and shared mutable state — not only the declared signature.',
        pros: 'When boundaries hold under load and policy pressure, this becomes a stable seam for multi-team ownership.',
        cons: 'Hunt for performance bottlenecks, lock/contention paths, leaky abstractions, and framework idioms that fight the domain model at scale.',
        arch:
          input.architecturalHints ||
          'Challenge whether this pattern still matches the domain boundary under multi-tenant, multi-region, or high-churn AI-assisted change.',
      };
  }
}

function truncate(text: string, max: number): string {
  const t = text.replace(/\s+/g, ' ').trim();
  return t.length <= max ? t : `${t.slice(0, max - 1)}…`;
}
