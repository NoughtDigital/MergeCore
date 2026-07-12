/**
 * MergeCore.dev homepage copy — UK English.
 */

export type Feature = {
  title: string;
  body: string;
};

export type ReviewMode = {
  title: string;
  body: string;
  command: string;
};

export type SetupItem = {
  label: string;
  body: string;
};

export type InstallPath = {
  id: "editor" | "agent";
  title: string;
  body: string;
  steps: string[];
  configLabel?: string;
  configSnippet?: string;
  note?: string;
};

export type Persona = {
  id: string;
  title: string;
  badge: string;
  tagline: string;
  focus: string[];
};

export type IntelligenceProfile = {
  id: string;
  title: string;
  badge: string;
  tagline: string;
};

export type ReviewLevel = {
  id: string;
  title: string;
  badge: string;
  tagline: string;
  scope: string;
};

export type InlineCommentExample = {
  label: string;
  before: string;
  after: string;
  note: string;
};

export type MemorySignal = {
  title: string;
  body: string;
};

export type ProdRiskCategory = {
  id: string;
  title: string;
  body: string;
};

export type TeachingExample = {
  label: string;
  weak: string;
  strong: string;
  sideEffectTag?: string;
};

export type HomepageCopy = {
  meta: {
    title: string;
    description: string;
  };
  hero: {
    badge: string;
    headline: string;
    subheadline: string;
    primaryCta: string;
    secondaryCta: string;
  };
  panelOverview: {
    eyebrow: string;
    headline: string;
    body: string;
    commandLine: string;
    panelNote: string;
  };
  featuresIntro: {
    eyebrow: string;
    headline: string;
    body: string;
  };
  features: Feature[];
  personasIntro: {
    eyebrow: string;
    headline: string;
    body: string;
  };
  personas: Persona[];
  intelligenceProfilesIntro: {
    eyebrow: string;
    headline: string;
    body: string;
  };
  intelligenceProfiles: IntelligenceProfile[];
  reviewLevelsIntro: {
    eyebrow: string;
    headline: string;
    body: string;
  };
  reviewLevels: ReviewLevel[];
  inlineCommentsIntro: {
    eyebrow: string;
    headline: string;
    body: string;
  };
  inlineCommentExamples: InlineCommentExample[];
  memoryIntro: {
    eyebrow: string;
    headline: string;
    body: string;
  };
  memorySignals: MemorySignal[];
  memoryNote: string;
  prodRisksIntro: {
    eyebrow: string;
    headline: string;
    body: string;
  };
  prodRiskCategories: ProdRiskCategory[];
  prodRisksNote: string;
  teachingIntro: {
    eyebrow: string;
    headline: string;
    body: string;
  };
  teachingExamples: TeachingExample[];
  teachingNote: string;
  reviewModesIntro: {
    eyebrow: string;
    headline: string;
    body: string;
  };
  reviewModes: ReviewMode[];
  setupIntro: {
    eyebrow: string;
    headline: string;
    body: string;
  };
  setupItems: SetupItem[];
  installPaths: InstallPath[];
  finalCta: {
    headline: string;
    body: string;
    button: string;
  };
  footer: {
    tagline: string;
    madeBy: {
      prefix: string;
      linkLabel: string;
      href: string;
    };
  };
};

export const homepageCopy: HomepageCopy = {
  meta: {
    title: "MergeCore — understand codebases, not just generate code",
    description:
      "Local-first repository cognition for VS Code and Cursor. Index privately, explain architecture on hover, and preserve engineering knowledge with adaptive junior-to-expert depth.",
  },
  hero: {
    badge: "Local engineering intelligence",
    headline: "Understand codebases, not just generate code.",
    subheadline:
      "MergeCore is a persistent engineering cognition layer for your repository — local indexing, local RAG, markdown memory, and hover explanations that teach architecture without shipping your source to the cloud.",
    primaryCta: "Install Extension",
    secondaryCta: "See Local Intelligence",
  },
  panelOverview: {
    eyebrow: "The workflow",
    headline: "Hover to understand. Index once. Keep knowledge local.",
    body: "MergeCore indexes on workspace open, watches the repo, builds a private knowledge store under .mergecore/rag/, and explains functions with summary, risks, related systems, and architectural context — tuned from junior through expert depth.",
    commandLine:
      "MergeCore: Index Repository · Set Explanation Mode · Set Intelligence Profile · Hover PHP symbols",
    panelNote:
      "It is not another Copilot, autocomplete tool, or PR comment bot. It is an engineering understanding system.",
  },
  featuresIntro: {
    eyebrow: "Why it helps",
    headline: "Onboarding, architecture, and AI-assisted quality — without cognitive overload.",
    body: "Teams encode decisions in markdown; MergeCore retrieves them locally so explanations stay business-context aware and stack-aware (Laravel first).",
  },
  features: [
    {
      title: "Local repository intelligence",
      body: "Indexes on workspace open, re-indexes on save, and builds a live knowledge store that stays on your machine.",
    },
    {
      title: "Local RAG database",
      body: "Each repository gets its own retrieval layer for functions, architecture notes, conventions, and business logic references.",
    },
    {
      title: "Markdown as engineering memory",
      body: "README, architecture.md, decisions.md, agents.md, and .cursorrules become active context for explanations.",
    },
    {
      title: "Hover explanations",
      body: "Function summary, inputs/outputs, pros, cons/risks, related systems, and architectural context — in the editor.",
    },
    {
      title: "Adaptive explanation depth",
      body: "Junior, mid, senior, and expert modes — from fundamentals to architecture critique, concurrency, and enterprise scale.",
    },
    {
      title: "Local-first by default",
      body: "Source, embeddings, and business logic stay local. Optional Ollama for richer explanations — never required for core cognition.",
    },
  ],
  personasIntro: {
    eyebrow: "Explanation modes",
    headline: "Same code. Depth that matches the reader.",
    body: "MergeCore changes how it explains systems based on developer level — so mixed-skill teams share one cognition layer without drowning juniors or boring seniors.",
  },
  personas: [
    {
      id: "junior",
      title: "Junior mode",
      badge: "Junior",
      tagline: "Fundamentals, concepts, common mistakes, simple reasoning.",
      focus: ["fundamentals", "concepts", "common-mistakes", "simple-reasoning"],
    },
    {
      id: "mid",
      title: "Mid-level mode",
      badge: "Mid",
      tagline: "Practical architecture, maintainability, workflow reasoning.",
      focus: ["architecture", "maintainability", "workflow", "delivery"],
    },
    {
      id: "senior",
      title: "Senior mode",
      badge: "Senior",
      tagline: "Scalability, hidden coupling, tradeoffs, operational concerns.",
      focus: ["scalability", "coupling", "tradeoffs", "operations"],
    },
    {
      id: "expert",
      title: "Expert mode",
      badge: "Expert",
      tagline: "Architecture critique, performance, concurrency, enterprise scale.",
      focus: ["critique", "performance", "concurrency", "enterprise"],
    },
  ],
  intelligenceProfilesIntro: {
    eyebrow: "Intelligence profiles",
    headline: "Same depth. A different reasoning lens.",
    body: "Profiles bias how MergeCore weighs tradeoffs — ship-fast, enterprise governance, security, performance, or AI-generated side effects — without changing explanation mode.",
  },
  intelligenceProfiles: [
    {
      id: "default",
      title: "Default",
      badge: "Balanced",
      tagline: "Balanced engineering reasoning.",
    },
    {
      id: "startup-mvp",
      title: "Startup MVP",
      badge: "Ship-fast",
      tagline: "Ship-fast bias with reversible decisions.",
    },
    {
      id: "enterprise",
      title: "Enterprise",
      badge: "Governance",
      tagline: "Governance, consistency, long-lived systems.",
    },
    {
      id: "performance",
      title: "Performance",
      badge: "Hot path",
      tagline: "Latency, throughput, and resource cost.",
    },
    {
      id: "security",
      title: "Security",
      badge: "Threat model",
      tagline: "Threat model and abuse paths.",
    },
    {
      id: "solo-founder",
      title: "Solo founder",
      badge: "Bus factor",
      tagline: "Cognitive load and bus-factor survival.",
    },
    {
      id: "rapid-prototyping",
      title: "Rapid prototyping",
      badge: "Explore",
      tagline: "Exploration over permanence.",
    },
    {
      id: "ai-safety",
      title: "AI safety",
      badge: "AI-aware",
      tagline: "Side effects of AI-generated systems.",
    },
  ],
  reviewLevelsIntro: {
    eyebrow: "Pricing (indicative)",
    headline: "Intelligence runs locally. Cloud only manages access.",
    body: "Authentication, billing, licensing, and seats can live in the cloud later — your code does not need to leave the machine for Phase 1 cognition.",
  },
  reviewLevels: [
    {
      id: "solo",
      title: "Solo",
      badge: "~£19/mo",
      tagline: "Local RAG, hover explanations, single-user features.",
      scope: "Individual",
    },
    {
      id: "team",
      title: "Team",
      badge: "~£29–39/seat",
      tagline: "Shared standards, organisation configs, seat management.",
      scope: "Team",
    },
    {
      id: "business",
      title: "Business",
      badge: "~£59–99/seat",
      tagline: "SSO path, enforced standards, compliance, admin controls.",
      scope: "Business",
    },
    {
      id: "enterprise",
      title: "Enterprise",
      badge: "Custom",
      tagline: "Self-hosted licensing, air-gapped, custom reasoning packs.",
      scope: "Enterprise",
    },
    {
      id: "mvp",
      title: "Phase 1 MVP",
      badge: "Now",
      tagline:
        "VS Code extension, local index, RAG, hovers, junior–expert modes, intelligence profiles, Laravel first.",
      scope: "Shipped path",
    },
  ],
  inlineCommentsIntro: {
    eyebrow: "In-editor intelligence",
    headline: "Explanations that name risks, not vibes.",
    body: "Hover tooltips cover what the code does, what enters and exits, why the shape works, what can go wrong, which systems connect, and why the pattern may have been chosen.",
  },
  inlineCommentExamples: [
    {
      label: "Function summary",
      before: "Does stuff with orders.",
      after: "Loads the order, authorises the actor, then dispatches FulfilOrderJob when payment clears.",
      note: "Plain English tied to the symbol under the cursor.",
    },
    {
      label: "Cons / risks",
      before: "Might be slow sometimes.",
      after: "N+1 risk on line items under load; no idempotency key on the charge retry path.",
      note: "Race conditions, coupling, scalability, and maintainability — named concretely.",
    },
    {
      label: "Related systems",
      before: "Uses some services.",
      after: "OrderController → FulfilOrderJob → Order model → Pest feature test.",
      note: "Controllers, jobs, models, tests, and routes surface as a map, not a guess.",
    },
  ],
  memoryIntro: {
    eyebrow: "Markdown intelligence",
    headline: "Treat docs as active engineering memory.",
    body: "MergeCore ingests README, architecture.md, decisions.md, agents.md, contributing.md, coding-standards.md, and .cursorrules so teams can encode architecture decisions, conventions, and AI behaviour rules once.",
  },
  memorySignals: [
    {
      title: "Architecture & decisions",
      body: "architecture.md and decisions.md bias explanations toward the patterns your team already chose.",
    },
    {
      title: "Agents & Cursor rules",
      body: "agents.md and .cursorrules become contextual engineering rules for local explanations.",
    },
    {
      title: "Convention detection",
      body: "Inferred stack conventions (actions, DTOs, Pest-first, TypeScript strict) plus optional .mergecore/conventions.json for team-declared rules.",
    },
    {
      title: "Laravel-first packs",
      body: "laravel-core agents.md loads automatically when artisan / Laravel signals are present.",
    },
    {
      title: "Live index",
      body: "Indexes on open; saves update .mergecore/rag/ incrementally — no manual sync step.",
    },
  ],
  memoryNote:
    "Profiles and RAG stay workspace-local. Lockfiles and manifests still refresh stack detection; source watches refresh the cognition index.",
  prodRisksIntro: {
    eyebrow: "Still available",
    headline: "Production-risk scan when you need a hard look.",
    body: "Secondary to cognition: a local scanner for the categories that wake on-call — race conditions, retries, missing transactions, queue failure modes, and more.",
  },
  prodRiskCategories: [
    {
      id: "race-conditions",
      title: "Race conditions",
      body: "Check-then-act, unsynchronised shared state, and concurrent writes that only fail under real traffic.",
    },
    {
      id: "retry-duplication",
      title: "Retry duplication",
      body: "Non-idempotent work on retry paths — double charges, duplicate rows, and repeated side effects.",
    },
    {
      id: "no-transactions",
      title: "Missing transactions",
      body: "Multi-step writes with no atomic boundary, leaving the system in half-committed states when one step fails.",
    },
    {
      id: "bad-queue-retries",
      title: "Bad queue retries",
      body: "Infinite retries, no backoff, no dead-letter path — the reason a single bad job can drown the whole worker fleet.",
    },
    {
      id: "memory-leaks",
      title: "Memory leaks",
      body: "Growing caches without bounds, listeners never torn down, closures that pin large objects for the life of the process.",
    },
    {
      id: "n-plus-one",
      title: "N+1 queries",
      body: "Loops that fire one query per item. Fast in dev, fatal under real traffic. Number one cause of slow endpoints.",
    },
    {
      id: "missing-indexes",
      title: "Missing indexes",
      body: "Queries on unindexed columns, sequential scans on tables that will grow, and joins without covering indexes.",
    },
    {
      id: "no-rate-limits",
      title: "No rate limits",
      body: "Public endpoints with no throttle, outbound calls with no budget, cron paths that fan out unbounded.",
    },
    {
      id: "weak-logging",
      title: "Weak logging",
      body: "Errors swallowed, logs with no correlation id, failures reported as info — the things that make incidents unsolvable at 3am.",
    },
  ],
  prodRisksNote:
    "Cognition is primary; review and prod-risk remain available as secondary tooling for merge-time judgement.",
  teachingIntro: {
    eyebrow: "Engineering reasoning",
    headline: "Explain tradeoffs, not just syntax.",
    body: "MergeCore preserves architectural reasoning under pressure — what enters and exits, what couples, what fails in prod, and why a pattern may have been chosen.",
  },
  teachingExamples: [
    {
      label: "Junior depth",
      weak: "This uses a service.",
      strong:
        "This controller should stay thin: validate the request, call one service/action, return a response. Putting pricing rules here makes them hard to test.",
      sideEffectTag: "Fundamentals",
    },
    {
      label: "Senior depth",
      weak: "Looks fine.",
      strong:
        "The job and HTTP path share a write without an idempotency key; a timeout retry can double-apply under load.",
      sideEffectTag: "Tradeoff",
    },
    {
      label: "Memory-aware",
      weak: "Follow best practices.",
      strong: "Per decisions.md, money mutations go through Actions — this helper bypasses that boundary.",
      sideEffectTag: "Team memory",
    },
  ],
  teachingNote:
    "Offline templates always ship the six-section hover structure; Ollama upgrades prose when a local model is available.",
  reviewModesIntro: {
    eyebrow: "Entry points",
    headline: "Start with understanding. Review remains optional.",
    body: "Index the repository, set junior-to-expert depth and an intelligence profile, then hover Laravel/PHP symbols. Secondary review commands remain for merge-time checks.",
  },
  reviewModes: [
    {
      title: "Index repository",
      body: "Build or refresh the local RAG store under .mergecore/rag/ — also runs on workspace open.",
      command: "mergecore.indexRepository",
    },
    {
      title: "Set explanation mode",
      body: "Switch between junior, mid, senior, and expert explanation depth.",
      command: "mergecore.setExplanationMode",
    },
    {
      title: "Set intelligence profile",
      body: "Bias reasoning toward startup, enterprise, security, performance, or AI-safety lenses.",
      command: "mergecore.setIntelligenceProfile",
    },
    {
      title: "Hover intelligence",
      body: "Hover PHP methods and classes for structured architectural explanations.",
      command: "editor.action.showHover",
    },
    {
      title: "Optional review",
      body: "Secondary: run a pack-aware review on a selection, file, or diff when you want merge-time judgement.",
      command: "mergecore.reviewFile",
    },
  ],
  setupIntro: {
    eyebrow: "Fits your setup",
    headline: "Install the editor extension. Connect agents with MCP.",
    body: "Humans get hover explanations and indexing in VS Code or Cursor. Agents (Cursor, Codex) query the same local cognition over MCP. Optional Skill tells the agent when to call those tools.",
  },
  setupItems: [
    {
      label: "Local by default",
      body: "Indexing, retrieval, and template explanations never need a MergeCore API token.",
    },
    {
      label: "Optional Ollama",
      body: "Point mergecore.local.ollamaBaseUrl at your local host for embeddings and chat — still on your machine.",
    },
    {
      label: "Licensing later",
      body: "Cloud can manage auth and seats later; Phase 1 cognition does not depend on it.",
    },
  ],
  installPaths: [
    {
      id: "editor",
      title: "VS Code / Cursor extension",
      body: "Human path: index the repo, set explanation mode, hover PHP symbols. One extension covers both editors.",
      steps: [
        "Build a VSIX: cd extension && npm install && npm run package",
        "Install via Extensions → Install from VSIX… (or use the CI mergecore-vsix artefact)",
        "Open a workspace, run MergeCore: Index Repository, then hover",
      ],
      note: "Cursor hosts VS Code extensions — you do not need a separate Cursor plugin.",
    },
    {
      id: "agent",
      title: "Cursor / Codex MCP",
      body: "Agent path: expose local RAG, packs, and prod-risk scan as tools. Point MERGECORE_WORKSPACE at the project root.",
      steps: [
        "Build the server: cd mcp && npm install && npm run build",
        "Add the stdio server to your MCP host config",
        "Optional: install the MergeCore Skill so the agent prefers MCP over guessing architecture",
      ],
      configLabel: "MCP config (Cursor / Codex)",
      configSnippet: `{
  "mcpServers": {
    "mergecore": {
      "command": "node",
      "args": ["/absolute/path/to/MergeCore/mcp/dist/index.js"],
      "env": {
        "MERGECORE_WORKSPACE": "/absolute/path/to/your/project"
      }
    }
  }
}`,
      note: "Tools: mergecore_index, mergecore_retrieve, mergecore_explain_context, mergecore_scan_prod_risks, mergecore_list_packs, mergecore_read_pack_guidance.",
    },
  ],
  finalCta: {
    headline: "A cognition layer for AI-assisted teams.",
    body: "Preserve engineering knowledge, onboard faster, and understand AI-generated systems — privately, in the editor.",
    button: "Install MergeCore",
  },
  footer: {
    tagline:
      "MergeCore — an engineering understanding system. Understand codebases, not just generate code.",
    madeBy: {
      prefix: "Made by",
      linkLabel: "nought.digital",
      href: "https://nought.digital",
    },
  },
};
