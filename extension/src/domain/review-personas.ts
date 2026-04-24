/**
 * Reviewer personas surfaced in the extension UI.
 *
 * The authoritative prompt text lives server-side in engine/pipeline/personas.ts;
 * the extension only needs the ids and presentation strings. Keep the id list
 * in sync with the engine module — the id is the only wire contract.
 */

export type ReviewPersonaId =
  | 'auto'
  | 'principal-engineer'
  | 'startup-cto'
  | 'security-lead'
  | 'refactor-veteran'
  | 'staff-mentor';

export interface ReviewPersona {
  readonly id: ReviewPersonaId;
  readonly title: string;
  readonly tagline: string;
  /** Short label used in the sidebar header chip. */
  readonly badge: string;
}

const PERSONA_LIST: readonly ReviewPersona[] = [
  {
    id: 'auto',
    title: 'MergeCore Default',
    tagline: 'Balanced senior-style review across the active pack.',
    badge: 'Default',
  },
  {
    id: 'principal-engineer',
    title: 'MergeCore Principal Engineer',
    tagline: 'Architecture obsessed. Boundaries, invariants, long-term cost.',
    badge: 'Principal',
  },
  {
    id: 'startup-cto',
    title: 'MergeCore Startup CTO',
    tagline: 'Ship fast, stay alive. Pragmatic over pristine.',
    badge: 'Startup CTO',
  },
  {
    id: 'security-lead',
    title: 'MergeCore Security Lead',
    tagline: 'Paranoid by trade. Treat every input as hostile.',
    badge: 'Security',
  },
  {
    id: 'refactor-veteran',
    title: 'MergeCore Refactor Veteran',
    tagline: 'Simplify aggressively. Delete more than you add.',
    badge: 'Refactor',
  },
  {
    id: 'staff-mentor',
    title: 'MergeCore Staff Mentor',
    tagline: 'Teaches juniors. Explains the why, not just the what.',
    badge: 'Mentor',
  },
];

const PERSONA_BY_ID: Readonly<Record<ReviewPersonaId, ReviewPersona>> = Object.freeze(
  PERSONA_LIST.reduce<Record<ReviewPersonaId, ReviewPersona>>((acc, p) => {
    acc[p.id] = p;
    return acc;
  }, {} as Record<ReviewPersonaId, ReviewPersona>)
);

export const REVIEW_PERSONAS: readonly ReviewPersona[] = PERSONA_LIST;

export const DEFAULT_PERSONA_ID: ReviewPersonaId = 'auto';

export function isPersonaId(value: string): value is ReviewPersonaId {
  return Object.prototype.hasOwnProperty.call(PERSONA_BY_ID, value);
}

export function getPersonaById(id: string | undefined | null): ReviewPersona {
  if (typeof id === 'string' && isPersonaId(id)) {
    return PERSONA_BY_ID[id];
  }
  return PERSONA_BY_ID[DEFAULT_PERSONA_ID];
}
