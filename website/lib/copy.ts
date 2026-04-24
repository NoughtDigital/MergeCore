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
