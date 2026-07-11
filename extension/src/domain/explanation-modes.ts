export type ExplanationMode = 'junior' | 'mid' | 'senior' | 'expert';

export type IntelligenceProfile =
  | 'default'
  | 'startup-mvp'
  | 'enterprise'
  | 'performance'
  | 'security'
  | 'solo-founder'
  | 'rapid-prototyping'
  | 'ai-safety';

export interface ExplanationModeInfo {
  readonly id: ExplanationMode;
  readonly title: string;
  readonly badge: string;
  readonly tagline: string;
  readonly promptBias: string;
}

export interface IntelligenceProfileInfo {
  readonly id: IntelligenceProfile;
  readonly title: string;
  readonly tagline: string;
  readonly promptBias: string;
}

export const EXPLANATION_MODES: readonly ExplanationModeInfo[] = [
  {
    id: 'junior',
    title: 'Junior',
    badge: 'Junior',
    tagline: 'Fundamentals, concepts, common mistakes, simple reasoning.',
    promptBias:
      'Explain for a junior developer: cover fundamentals, name core concepts clearly, call out common mistakes, and keep reasoning simple and concrete.',
  },
  {
    id: 'mid',
    title: 'Mid-level',
    badge: 'Mid',
    tagline: 'Practical architecture, maintainability, workflow reasoning.',
    promptBias:
      'Explain for a mid-level engineer: emphasise practical architecture, maintainability, workflow reasoning, and how this fits the day-to-day delivery path.',
  },
  {
    id: 'senior',
    title: 'Senior',
    badge: 'Senior',
    tagline: 'Scalability, coupling, tradeoffs, operational concerns.',
    promptBias:
      'Explain for a senior engineer: focus on scalability, hidden coupling, architectural tradeoffs, and operational concerns. Be concise and critical.',
  },
  {
    id: 'expert',
    title: 'Expert',
    badge: 'Expert',
    tagline: 'Architecture critique, performance, concurrency, framework philosophy, enterprise scale.',
    promptBias:
      'Explain for an expert: critique architecture, surface performance bottlenecks, concurrency hazards, framework philosophy conflicts, and enterprise scaling implications.',
  },
] as const;

export const INTELLIGENCE_PROFILES: readonly IntelligenceProfileInfo[] = [
  {
    id: 'default',
    title: 'Default',
    tagline: 'Balanced engineering reasoning.',
    promptBias: 'Balance correctness, clarity, and maintainability.',
  },
  {
    id: 'startup-mvp',
    title: 'Startup MVP',
    tagline: 'Ship-fast bias with reversible decisions.',
    promptBias: 'Optimise for MVP speed: reversible decisions, YAGNI, and clear kill-switches.',
  },
  {
    id: 'enterprise',
    title: 'Enterprise',
    tagline: 'Governance, consistency, long-lived systems.',
    promptBias: 'Optimise for enterprise constraints: consistency, auditability, and long-term operability.',
  },
  {
    id: 'performance',
    title: 'Performance',
    tagline: 'Latency, throughput, and resource cost.',
    promptBias: 'Prioritise latency, throughput, allocation cost, and hot-path efficiency.',
  },
  {
    id: 'security',
    title: 'Security',
    tagline: 'Threat model and abuse paths.',
    promptBias: 'Prioritise authz, input trust boundaries, secrets, and abuse paths.',
  },
  {
    id: 'solo-founder',
    title: 'Solo founder',
    tagline: 'Cognitive load and bus-factor survival.',
    promptBias: 'Optimise for a solo founder: minimise cognitive load, favour boring tech, and document intent.',
  },
  {
    id: 'rapid-prototyping',
    title: 'Rapid prototyping',
    tagline: 'Exploration over permanence.',
    promptBias: 'Treat this as a prototype: favour clarity of experiment over permanence.',
  },
  {
    id: 'ai-safety',
    title: 'AI safety',
    tagline: 'Side effects of AI-generated systems.',
    promptBias:
      'Evaluate AI-assisted code carefully: hidden coupling, unverified assumptions, and unsafe generated patterns.',
  },
] as const;

export function getExplanationMode(id: string | undefined): ExplanationModeInfo {
  const hit = EXPLANATION_MODES.find((m) => m.id === id);
  return hit ?? EXPLANATION_MODES[0]!;
}

export function isExplanationMode(id: string): id is ExplanationMode {
  return id === 'junior' || id === 'mid' || id === 'senior' || id === 'expert';
}

export function getIntelligenceProfile(id: string | undefined): IntelligenceProfileInfo {
  const hit = INTELLIGENCE_PROFILES.find((p) => p.id === id);
  return hit ?? INTELLIGENCE_PROFILES[0]!;
}

export function isIntelligenceProfile(id: string): id is IntelligenceProfile {
  return INTELLIGENCE_PROFILES.some((p) => p.id === id);
}
