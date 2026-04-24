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

export type Persona = {
  id: string;
  title: string;
  badge: string;
  tagline: string;
  focus: string[];
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
    title: "MergeCore — catch what seniors would flag before review",
    description:
      "MergeCore reviews your code inside VS Code and Cursor, catches risky logic through stack-specific packs, and helps clean up weak AI-generated code before PR review starts.",
  },
  hero: {
    badge: "VS Code / Cursor extension",
    headline: "Vibe code freely. MergeCore catches what seniors would flag.",
    subheadline:
      "Review a snippet, file, or git diff inside VS Code and Cursor. MergeCore spots risky pack-specific mistakes, weak AI-generated code, and messy logic — then helps you fix it before review begins.",
    primaryCta: "Install Extension",
    secondaryCta: "See It Catch Real Issues",
  },
  panelOverview: {
    eyebrow: "The workflow",
    headline: "Review code where it actually matters: before commit.",
    body: "Run MergeCore on a snippet, file, staged diff, or working tree. Get actionable findings, severity scores, pack-aware feedback, and rewrites you can apply immediately.",
    commandLine:
      "MergeCore: Review Selection · Review Active File · Review Git Diff · Review Staged Diff",
    panelNote:
      "It is built for the moment confidence drops: after the code works, before someone else has to review the mess.",
  },
  featuresIntro: {
    eyebrow: "Why it helps",
    headline: "Fewer pointless PR comments. Better code shipped faster.",
    body: "MergeCore reads project signals and applies versioned rules packs, so feedback feels closer to a sharp engineer than a generic AI lint pass.",
  },
  features: [
    {
      title: "Use it at the exact level you need",
      body: "Review one risky method or an entire file. No need to wait for a full PR cycle to get useful feedback.",
    },
    {
      title: "See issues where you're already working",
      body: "Findings appear inside the editor, so you can fix problems while context is still fresh.",
    },
    {
      title: "Review before team overhead",
      body: "Catch weak assumptions, rough edges, and AI sludge before someone else has to point it out.",
    },
    {
      title: "Get feedback that leads somewhere",
      body: "Not vague complaints. Real findings, code examples, and practical rewrites.",
    },
    {
      title: "Apply improvements instantly",
      body: "Accept patches directly in-editor or export a markdown review for your team.",
    },
    {
      title: "Built for modern stacks",
      body: "Pack first. Add language, framework, testing, frontend, backend, mobile, and domain-specific rules without changing the review workflow.",
    },
  ],
  personasIntro: {
    eyebrow: "Review modes · Personas",
    headline: "Pick the reviewer looking over your shoulder.",
    body: "The same pack, the same rules, reviewed through a different lens. Personas tune emphasis, tone, and triage without ever inventing evidence or dropping the ground rules.",
  },
  personas: [
    {
      id: "auto",
      title: "MergeCore Default",
      badge: "Default",
      tagline: "Balanced senior-style review across the active pack.",
      focus: ["correctness", "security", "maintainability", "operability"],
    },
    {
      id: "principal-engineer",
      title: "Principal Engineer",
      badge: "Principal",
      tagline: "Architecture obsessed. Boundaries, invariants, long-term cost.",
      focus: ["architecture", "boundaries", "invariants", "api-design"],
    },
    {
      id: "startup-cto",
      title: "Startup CTO",
      badge: "Startup CTO",
      tagline: "Ship fast, stay alive. Pragmatic over pristine.",
      focus: ["shipability", "risk-vs-speed", "blast-radius", "revert-cost"],
    },
    {
      id: "security-lead",
      title: "Security Lead",
      badge: "Security",
      tagline: "Paranoid by trade. Treat every input as hostile.",
      focus: ["auth", "input-validation", "secrets", "data-exposure"],
    },
    {
      id: "refactor-veteran",
      title: "Refactor Veteran",
      badge: "Refactor",
      tagline: "Simplify aggressively. Delete more than you add.",
      focus: ["simplicity", "dead-code", "duplication", "control-flow"],
    },
    {
      id: "staff-mentor",
      title: "Staff Mentor",
      badge: "Mentor",
      tagline: "Teaches juniors. Explains the why, not just the what.",
      focus: ["teachability", "rationale", "idioms", "pitfalls"],
    },
  ],
  reviewLevelsIntro: {
    eyebrow: "Multi-level review buttons",
    headline: "One click picks the depth, not just the target.",
    body: "Scope is how the code gets sent to the engine. A review level is what you want the engine to do with it — a quick sanity pass, a whole-file sweep, a flow across files, a proper PR review, or a broad disaster hunt.",
  },
  reviewLevels: [
    {
      id: "quick",
      title: "Quick Review",
      badge: "Quick",
      tagline: "Current function only. Fast, focused sanity check.",
      scope: "Selection",
    },
    {
      id: "file",
      title: "File Review",
      badge: "File",
      tagline: "Current file end-to-end, as a cohesive unit.",
      scope: "Active file",
    },
    {
      id: "flow",
      title: "Flow Review",
      badge: "Flow",
      tagline: "Linked files plus the business process that runs through them.",
      scope: "File + related context",
    },
    {
      id: "pr",
      title: "PR Review",
      badge: "PR",
      tagline: "Changed files with impact analysis across the diff.",
      scope: "Git diff",
    },
    {
      id: "disaster",
      title: "Disaster Review",
      badge: "Disaster",
      tagline: "Find everything wrong. Broad, unsparing sweep.",
      scope: "Active file",
    },
  ],
  inlineCommentsIntro: {
    eyebrow: "Strong inline comments",
    headline: "Review comments that actually say something.",
    body: "MergeCore rewrites its own output. Hedged openings, empty verdicts, and vague \"refactor this\" one-liners get caught by a defence-in-depth pass so every finding lands as a decision, not a suggestion.",
  },
  inlineCommentExamples: [
    {
      label: "Hedged opening",
      before: "Consider maybe adding a null check here when the user is missing.",
      after: "Guard against `user` being null before dereferencing `user.id`; otherwise this throws in the logged-out branch.",
      note: "\"Consider\", \"maybe\", \"might want to\" — softeners that turn a call into a shrug — get stripped.",
    },
    {
      label: "Empty verdict",
      before: "This is a bit messy and could be cleaner.",
      after: "Extract the three nested `try/catch` branches into `parsePayload()` so the happy path reads top-to-bottom.",
      note: "\"Needs work\", \"a bit messy\", \"could be better\" describe a feeling, not a fix. They get replaced or dropped.",
    },
    {
      label: "Targetless refactor",
      before: "Refactor this.",
      after: "Split `processOrder()` — the validation, pricing, and persistence steps each deserve their own function.",
      note: "Bare \"refactor this\" names no target. Strong comments must say what to extract, split, rename, or remove.",
    },
  ],
  memoryIntro: {
    eyebrow: "Contextual memory",
    headline: "Review that remembers how your project is wired.",
    body: "Before a review runs, MergeCore fingerprints the workspace: dependencies, test setup, TypeScript strictness, domain layout, and any conventions your team has declared. That profile is cached, auto-invalidated when it should be, and fed back into every review so feedback stays stack-aware.",
  },
  memorySignals: [
    {
      title: "Dependencies & runtime",
      body: "package.json, composer.json, lockfiles, tsconfig — used to decide which packs apply and which ecosystem idioms to expect.",
    },
    {
      title: "Domain layout",
      body: "Detects patterns like Actions, Commands, Repositories, DTOs, typed requests, and service-over-helper style so findings match how your codebase is actually structured.",
    },
    {
      title: "Testing style",
      body: "Spots the test runner, assertion style, and fixtures in use so reviews point at tests the same way your repo already writes them.",
    },
    {
      title: "Declared conventions",
      body: "Team rules in .mergecore/conventions.json win on conflicts. Write them down once; every review respects them.",
    },
  ],
  memoryNote:
    "Profiles are cached per workspace with a short TTL and auto-invalidate the instant a lockfile, tsconfig, or conventions file changes — so the review that runs after composer require or npm install already knows about the new dependency.",
  prodRisksIntro: {
    eyebrow: "What Breaks In Prod?",
    headline: "A scanner for the nine things that wake on-call up.",
    body: "A pack-agnostic scanner dedicated to production-risk categories, not style. Built-in rules ship with the engine; packs contribute stack-specific rules as pure data, so adding coverage for a new framework never means shipping new scanner code.",
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
    "Rules are data only: regex sources, language gates, and workspace-signal requirements. Malformed pack rules are dropped silently so one bad entry cannot break the scanner — built-ins remain authoritative.",
  teachingIntro: {
    eyebrow: "Explain Why",
    headline: "Every criticism has to teach something.",
    body: "A finding that says what is wrong but not why leaves the reader with nothing to internalise. MergeCore enforces a teaching bar: critical, error, and warning findings must carry a substantive why_it_matters, and hidden side effects get a dedicated callout so readers cannot miss them during review.",
  },
  teachingExamples: [
    {
      label: "Shallow why",
      weak: "This is not best practice.",
      strong: "The handler returns before the write completes; under load the client will see stale reads from the replica until the next commit catches up, which is how we got yesterday's incident.",
      sideEffectTag: "Restates the rule",
    },
    {
      label: "Unspecified risk",
      weak: "This might cause issues.",
      strong: "Retrying the charge call on timeout without an idempotency key double-bills on the second attempt; Stripe keeps both charges and we have to refund manually.",
      sideEffectTag: "No concrete cost named",
    },
    {
      label: "Hidden side effect",
      weak: "This function silently swallows errors.",
      strong: "The bare catch block discards the DB error, so the caller sees success while the row was never written; the read-back a few lines down returns empty and the endpoint responds 200 with no data.",
      sideEffectTag: "Hidden side effect",
    },
  ],
  teachingNote:
    "The enforcement runs on both the engine and the host, so even a weakly-worded response from the model gets surfaced in the sidebar as a \"Hidden side effect\" tag or a neutral reviewer note — never silently accepted.",
  reviewModesIntro: {
    eyebrow: "Entry points",
    headline: "Run review exactly where confidence drops.",
    body: "Use MergeCore on the part of the change that feels risky, messy, or just too AI-written to trust on the first pass.",
  },
  reviewModes: [
    {
      title: "Selection review",
      body: "Perfect for a risky block, fresh refactor, or the method that feels fine until you look twice.",
      command: "mergecore.reviewSelection",
    },
    {
      title: "Active file review",
      body: "Run a full pass when the whole file needs a proper sanity check, not just one highlighted section.",
      command: "mergecore.reviewFile",
    },
    {
      title: "Working tree diff review",
      body: "Check your in-progress branch before it turns into a pile of fixes, follow-ups, and reviewer comments.",
      command: "mergecore.reviewGitDiff",
    },
    {
      title: "Staged diff review",
      body: "Give the exact staged patch one last senior-style pass before you commit it or send it up for review.",
      command: "mergecore.reviewStagedDiff",
    },
  ],
  setupIntro: {
    eyebrow: "Fits your setup",
    headline: "Easy to try. Serious when you need it.",
    body: "The extension is designed so you can get a feel for the workflow immediately, then connect it to your configured MergeCore API environment when you are ready for the full backend-driven path.",
  },
  setupItems: [
    {
      label: "Start without ceremony",
      body: "You can install the extension and get through the review workflow without first wrestling with account setup, tokens, or external plumbing.",
    },
    {
      label: "Connect your review backend when ready",
      body: "When you want MergeCore running against your configured API, add your base URL and token in settings and switch the extension over to that path.",
    },
    {
      label: "Stay in flow",
      body: "The Review panel can open automatically after a run, and it can fall back to a beside tab when the activity-bar view is not available in your editor host.",
    },
  ],
  finalCta: {
    headline: "Write fast. Review smart. Merge confidently.",
    body: "Give the branch one last senior pass before review starts, and catch the stuff that makes people lose confidence fast.",
    button: "See It Catch Real Issues",
  },
  footer: {
    tagline:
      "MergeCore helps you catch the stuff that would otherwise get flagged in review.",
    madeBy: {
      prefix: "Made by",
      linkLabel: "nought.digital",
      href: "https://nought.digital",
    },
  },
};
