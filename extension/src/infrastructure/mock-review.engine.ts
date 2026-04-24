import type { ProjectConvention } from '@mergecore/intelligence';
import type { ReviewEngine } from '../application/ports/review-engine.port';
import type { ReviewRequest, ReviewResult } from '../domain/review-types';
import { getPersonaById, type ReviewPersonaId } from '../domain/review-personas';
import { getReviewLevelById, type ReviewLevelId } from '../domain/review-levels';

function fnv1a32(input: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}

const FINGERPRINT_LABELS: Readonly<Record<string, string>> = {
  filament: 'Filament',
  inertia: 'Inertia',
  livewire: 'Livewire',
  pest: 'Pest',
  phpunit: 'PHPUnit',
  react: 'React',
  typescript: 'TypeScript',
  vite: 'Vite',
  vue: 'Vue',
  'js:package-json': 'Node (package.json)',
  'php:composer': 'Composer',
  'path:artisan': 'Artisan',
  'path:php-app-layout': 'PHP app layout',
  'path:pest.php': 'Pest',
  'path:phpunit': 'PHPUnit',
  'path:vite.config': 'Vite',
  'path:tsconfig': 'TypeScript config',
};

function titleCaseWords(s: string): string {
  return s
    .split(/\s+/)
    .map((w) => (w.length ? w[0].toUpperCase() + w.slice(1).toLowerCase() : w))
    .join(' ');
}

/** Turns internal fingerprint tokens into short labels for the mock summary line. */
function humaniseFingerprintToken(token: string): string {
  const mapped = FINGERPRINT_LABELS[token];
  if (mapped) {
    return mapped;
  }
  if (token.startsWith('path:')) {
    const rest = token.slice(5).replace(/-/g, ' ');
    return titleCaseWords(rest);
  }
  if (token.startsWith('js:')) {
    return `JS: ${titleCaseWords(token.slice(3).replace(/-/g, ' '))}`;
  }
  if (token.startsWith('php:')) {
    return titleCaseWords(token.slice(4).replace(/-/g, ' '));
  }
  return titleCaseWords(token.replace(/-/g, ' '));
}

function formatFingerprintForSummary(fingerprint: string): string {
  if (fingerprint === 'generic' || fingerprint.trim() === '') {
    return '';
  }
  const labels = fingerprint.split('|').map(humaniseFingerprintToken);
  const seen = new Set<string>();
  const unique: string[] = [];
  for (const label of labels) {
    if (!seen.has(label)) {
      seen.add(label);
      unique.push(label);
    }
  }
  if (unique.length === 0) {
    return '';
  }
  if (unique.length === 1) {
    return unique[0];
  }
  if (unique.length === 2) {
    return `${unique[0]} and ${unique[1]}`;
  }
  return `${unique.slice(0, -1).join(', ')}, and ${unique[unique.length - 1]}`;
}

interface PersonaMockTone {
  readonly summaryPrefix: string;
  readonly dynamicExec: { message: string; whyItMatters: string; fixHint: string; severity: 'warning' | 'error' | 'critical' };
  readonly openWork: { message: string; whyItMatters: string; fixHint: string; severity: 'hint' | 'info' };
}

const PERSONA_TONES: Readonly<Record<ReviewPersonaId, PersonaMockTone>> = {
  auto: {
    summaryPrefix: '',
    dynamicExec: {
      severity: 'warning',
      message: 'Dynamic execution can be risky; ensure untrusted input cannot reach it.',
      whyItMatters:
        'Runtime execution APIs can turn validation gaps into command or code injection issues across stacks.',
      fixHint: 'Prefer a narrow API, allowlisted commands, or structured library calls.',
    },
    openWork: {
      severity: 'hint',
      message: 'Open TODO/FIXME marker left in reviewed code.',
      whyItMatters:
        'Outstanding markers make review intent ambiguous and can hide unfinished behaviour.',
      fixHint: 'Resolve the marker or link it to tracked follow-up work.',
    },
  },
  'principal-engineer': {
    summaryPrefix: 'Principal-engineer lens: weighting architecture, boundaries and long-term cost.',
    dynamicExec: {
      severity: 'warning',
      message: 'Dynamic execution crosses a trust boundary that the surrounding module does not advertise.',
      whyItMatters:
        'Shelling out from a domain layer blurs module boundaries and couples business rules to shell semantics, which makes refactors and failure handling architecturally expensive.',
      fixHint: 'Move the call behind an explicit port (e.g. a CommandRunner) so the rest of the system stays free of process-level concerns.',
    },
    openWork: {
      severity: 'info',
      message: 'Unresolved TODO/FIXME — architectural intent is unclear at this seam.',
      whyItMatters:
        'Markers at module boundaries make it hard to reason about invariants and who owns the follow-up work.',
      fixHint: 'Either decide the contract now or capture the ambiguity as an issue linked from this marker.',
    },
  },
  'startup-cto': {
    summaryPrefix: 'Startup-CTO lens: shippability first — flagging only what creates real risk or blocks the merge.',
    dynamicExec: {
      severity: 'warning',
      message: 'Dynamic execution present — cheap safeguard now beats a weekend incident later.',
      whyItMatters:
        'In a moving codebase, dynamic execution is the most common route from a small validation gap to an outage or data incident.',
      fixHint: 'Add the narrowest possible input check today; revisit the whole pattern after ship if it is hot-path.',
    },
    openWork: {
      severity: 'hint',
      message: 'TODO/FIXME left in — fine to ship if tracked, risky if forgotten.',
      whyItMatters:
        'Stale markers bite when the author forgets them; tracking them is the cheapest way to keep velocity honest.',
      fixHint: 'Link the marker to a ticket or delete it; do not block the ship on rewriting it.',
    },
  },
  'security-lead': {
    summaryPrefix: 'Security lens: every input is hostile until evidenced otherwise.',
    dynamicExec: {
      severity: 'critical',
      message: 'Dynamic execution sink: treat as exploitable until input provenance is proven.',
      whyItMatters:
        'eval/exec/shell_exec are classic RCE primitives. Any data that reaches them from a request, queue, file or config must be proven trusted through an allowlist, not a denylist.',
      fixHint: 'Replace with a typed API; if unavoidable, pass only allowlisted literal tokens and log the invocation for audit.',
    },
    openWork: {
      severity: 'info',
      message: 'TODO/FIXME — may conceal an un-mitigated threat model assumption.',
      whyItMatters:
        'Security-relevant TODOs (auth, validation, secrets) are the ones most likely to reach production still broken.',
      fixHint: 'Classify the marker: if it touches auth, validation or secrets, raise its severity and resolve before merge.',
    },
  },
  'refactor-veteran': {
    summaryPrefix: 'Refactor lens: simplify aggressively, delete more than you add.',
    dynamicExec: {
      severity: 'warning',
      message: 'Dynamic execution — almost certainly replaceable by a narrower, named API.',
      whyItMatters:
        'eval/exec are usually a symptom of a missing abstraction. Keeping them means every future reader has to reason about string semantics instead of a typed call.',
      fixHint: 'Extract the two or three concrete shapes this call takes today and expose each as its own small function.',
    },
    openWork: {
      severity: 'hint',
      message: 'TODO/FIXME — candidate for deletion rather than resolution.',
      whyItMatters:
        'Most stale TODOs describe work that the codebase has already routed around; keeping them adds cognitive load without adding signal.',
      fixHint: 'Delete the marker if the surrounding code is already correct; otherwise collapse it into a one-line decision.',
    },
  },
  'staff-mentor': {
    summaryPrefix: 'Mentor lens: teaching the why behind each finding, not just the rule.',
    dynamicExec: {
      severity: 'warning',
      message: 'Dynamic execution — here is how a senior reasons about it.',
      whyItMatters:
        'The danger is not the keyword but the contract: exec-style APIs promise to run whatever string they receive. That means correctness depends on every caller, forever, never passing untrusted data. That guarantee is extremely hard to keep in a growing team.',
      fixHint: 'Teaching move: ask "what are the only valid inputs?" If you can enumerate them, you can replace exec with a small dispatcher over that enum.',
    },
    openWork: {
      severity: 'hint',
      message: 'TODO/FIXME — good moment to model decision hygiene.',
      whyItMatters:
        'Code comments accumulate like sediment. A useful habit for juniors: every TODO must answer "who, by when, under what condition" — otherwise it is not a plan, it is a wish.',
      fixHint: 'Either rewrite the marker with an owner and trigger, or delete it — both are better than leaving it ambiguous.',
    },
  },
};

/**
 * Per-level flavour for the mock. Real prompt emphasis lives in the engine
 * pipeline; this table only exists so the offline UX visibly changes when
 * the user picks a different level button, without hardcoding a large
 * per-level branching ladder in the engine.
 *
 * Adding a new level id here is optional — missing ids fall back to the
 * default tone, so the mock keeps working while the engine catches up.
 */
interface LevelMockTone {
  readonly summaryPrefix: string;
  readonly findingCap: number;
  /** Scalar applied to the deterministic rule weight for scoring (higher = harsher). */
  readonly weightScale: number;
}

const LEVEL_TONES: Readonly<Record<ReviewLevelId, LevelMockTone>> = {
  quick: {
    summaryPrefix: 'Quick Review lens: function-scoped sanity check.',
    findingCap: 5,
    weightScale: 0.8,
  },
  file: {
    summaryPrefix: '',
    findingCap: 12,
    weightScale: 1.0,
  },
  flow: {
    summaryPrefix:
      'Flow Review lens: tracing the business process across linked files (no real cross-file analysis in mock).',
    findingCap: 15,
    weightScale: 1.05,
  },
  pr: {
    summaryPrefix: 'PR Review lens: change-impact analysis over your diff.',
    findingCap: 18,
    weightScale: 1.1,
  },
  disaster: {
    summaryPrefix: 'Disaster Review lens: broad, unsparing sweep (mock still limited — real reviewer will find more).',
    findingCap: 25,
    weightScale: 1.25,
  },
};

export class MockReviewEngine implements ReviewEngine {
  async review(request: ReviewRequest): Promise<ReviewResult> {
    const persona = getPersonaById(request.reviewerPersonaId);
    const level = getReviewLevelById(request.reviewLevelId);
    const tone = PERSONA_TONES[persona.id];
    const levelTone = LEVEL_TONES[level.id];
    const findings: ReviewResult['findings'][number][] = [];

    if (/\b(eval|exec|shell_exec|child_process\.exec)\s*\(/i.test(request.content)) {
      findings.push({
        id: 'mock-dynamic-exec',
        severity: tone.dynamicExec.severity,
        message: tone.dynamicExec.message,
        whyItMatters: tone.dynamicExec.whyItMatters,
        fixHint: tone.dynamicExec.fixHint,
        line: undefined,
        category: 'security',
        code: 'MERGECORE_DYNAMIC_EXEC',
      });
    }

    if (/\b(TODO|FIXME)\b/.test(request.content)) {
      findings.push({
        id: 'mock-open-work',
        severity: tone.openWork.severity,
        message: tone.openWork.message,
        whyItMatters: tone.openWork.whyItMatters,
        fixHint: tone.openWork.fixHint,
        category: 'maintainability',
        code: 'MERGECORE_OPEN_WORK',
      });
    }

    // Disaster Review wants breadth: surface a couple of extra mock findings
    // when the evidence exists, so users see a visible difference between
    // levels even without the real reviewer. Still honours the findingCap.
    if (level.id === 'disaster') {
      if (/console\.log\s*\(/.test(request.content)) {
        findings.push({
          id: 'mock-console-log',
          severity: 'hint',
          message: 'Leftover console.log in reviewed code.',
          whyItMatters: 'Stray logging obscures signal in production logs and can leak user data.',
          fixHint: 'Replace with a scoped logger or delete if temporary.',
          category: 'operability',
          code: 'MERGECORE_CONSOLE_LOG',
        });
      }
      if (/\b(any|unknown)\b\s*[;,)]/.test(request.content)) {
        findings.push({
          id: 'mock-any-leak',
          severity: 'info',
          message: 'Loosely-typed value escapes the function boundary.',
          whyItMatters:
            'Any/unknown at a boundary shifts the cost of a mistake to every future caller.',
          fixHint: 'Narrow the type at the boundary, or wrap the call and assert the shape.',
          category: 'maintainability',
          code: 'MERGECORE_LOOSE_TYPE',
        });
      }
    }

    const conventions = request.projectProfile?.conventions ?? [];
    const divergences = detectConventionDivergences(conventions, request.content);
    for (const divergence of divergences) {
      findings.push(divergence);
    }

    const cappedFindings = findings.slice(0, levelTone.findingCap);

    // Persona shifts severity weighting; level scales how harshly we feel it
    // so Disaster Review scores lower than Quick Review for the same code.
    const severityWeight = cappedFindings.reduce(
      (sum, f) => sum + severityCost(f.severity) * levelTone.weightScale,
      0
    );
    const seed = `${persona.id}\0${level.id}\0${request.filePath}\0${request.content.slice(0, 4000)}`;
    const h = fnv1a32(seed);
    const jitter = (h % 10000) / 10000 - 0.5;
    const raw = 9.34 - severityWeight + jitter * 0.36;
    const score = Math.round(Math.max(3, Math.min(10, raw)) * 100) / 100;

    const baseSummary =
      request.scope === 'git-diff'
        ? 'This is a mock review of your git diff. Add your MergeCore API token in settings for a full senior-style pass against your packs.'
        : 'This is a mock review so you can try the flow without an account. Run "MergeCore: Set API Token" and set mergecore.useMockReviewer to false for the real senior-style reviewer.';
    const stackPhrase = request.projectProfile?.fingerprint
      ? formatFingerprintForSummary(request.projectProfile.fingerprint)
      : '';
    const profileHint = stackPhrase
      ? ` Workspace looks like: ${stackPhrase}.`
      : '';
    const contextCount = request.relatedContext?.files.length ?? 0;
    const contextHint = contextCount > 0
      ? ` Auto-scanned ${contextCount} related file${contextCount === 1 ? '' : 's'} for entrypoints, domain logic, tests, config, and schema signals.`
      : '';
    const memoryHint = formatRememberedConventions(conventions);
    const personaPrefix = tone.summaryPrefix ? `${tone.summaryPrefix} ` : '';
    const levelPrefix = levelTone.summaryPrefix ? `${levelTone.summaryPrefix} ` : '';

    return {
      findings: cappedFindings,
      score,
      summary: levelPrefix + personaPrefix + baseSummary + profileHint + contextHint + memoryHint,
      improvedCode: undefined,
      patch: undefined,
    };
  }
}

/**
 * Offline critique against the repo's remembered conventions. The mock only
 * emits a finding when the divergence is visible in the reviewed input
 * itself — we never fabricate evidence. The real reviewer does a much
 * richer job; this exists so users see the memory feature working without
 * an API token.
 */
function detectConventionDivergences(
  conventions: readonly ProjectConvention[],
  content: string
): Array<{
  id: string;
  severity: 'warning' | 'info';
  message: string;
  whyItMatters: string;
  fixHint: string;
  category: string;
  code: string;
}> {
  if (conventions.length === 0) {
    return [];
  }
  const out: ReturnType<typeof detectConventionDivergences> = [];
  const has = (id: string): boolean => conventions.some((c) => c.id === id);

  if (has('arch:actions-pattern') && /\bclass\s+[A-Z][A-Za-z0-9_]*Service\b/.test(content)) {
    out.push({
      id: 'mock-convention-service-in-actions-repo',
      severity: 'warning',
      message:
        'New Service class diverges from the repo convention `arch:actions-pattern`. Add it as an invokable Action, not a Service.',
      whyItMatters:
        'The repo is already organised around single-responsibility Actions. Introducing a Service at this seam splits the team across two competing patterns and makes future refactors harder.',
      fixHint:
        'Rename to `<Verb><Noun>Action`, move under `Actions/`, and expose the work through `handle()` or `__invoke()`.',
      category: 'architecture',
      code: 'MERGECORE_CONVENTION_DIVERGENCE',
    });
  }

  if (
    has('testing:pest-first') &&
    /\bclass\s+\w+\s+extends\s+TestCase\b/.test(content) &&
    !/^\s*(it|test|describe)\s*\(/m.test(content)
  ) {
    out.push({
      id: 'mock-convention-phpunit-in-pest-repo',
      severity: 'warning',
      message:
        'PHPUnit class-based test added in a Pest-first repo. Convention `testing:pest-first` expects `it()`/`test()`/`describe()` style.',
      whyItMatters:
        'Mixing test styles fragments the test runner output and the mental model for every contributor touching tests afterwards.',
      fixHint: 'Rewrite as a Pest test using `it(...)` / `test(...)` in the same folder; delete the TestCase subclass.',
      category: 'testing',
      code: 'MERGECORE_CONVENTION_DIVERGENCE',
    });
  }

  if (
    has('data:typed-requests') &&
    /\$request->(all|input)\s*\(|\breq\.body\b|\bbody\s*:\s*any\b/.test(content)
  ) {
    out.push({
      id: 'mock-convention-untyped-request',
      severity: 'warning',
      message:
        'Reviewed code reads the raw request body; convention `data:typed-requests` expects a typed request/schema at this boundary.',
      whyItMatters:
        'Skipping the typed-request layer removes the project-wide validation guarantee and leaks unshaped input into the domain.',
      fixHint:
        'Extract a typed request/schema object (FormRequest / Zod / Pydantic, whichever this repo uses) and bind the handler to it.',
      category: 'security',
      code: 'MERGECORE_CONVENTION_DIVERGENCE',
    });
  }

  if (
    has('types:typescript-strict') &&
    /\bas\s+any\b|:\s*any\b/.test(content)
  ) {
    out.push({
      id: 'mock-convention-any-in-strict-repo',
      severity: 'warning',
      message:
        '`any` leaks into a strict-TypeScript repo. Convention `types:typescript-strict` expects narrowed types at every boundary.',
      whyItMatters:
        'An `any` in a strict codebase silently opts the rest of the team out of the guarantees they rely on during reviews.',
      fixHint: 'Model the real shape (or `unknown` + narrow) rather than widening to `any`.',
      category: 'maintainability',
      code: 'MERGECORE_CONVENTION_DIVERGENCE',
    });
  }

  return out;
}

/**
 * Builds the "Remembered: …" trailer appended to the mock summary so the
 * user can see which conventions the plugin is critiquing against without
 * running the real reviewer.
 */
function formatRememberedConventions(conventions: readonly ProjectConvention[]): string {
  if (conventions.length === 0) {
    return '';
  }
  const top = conventions.slice(0, 4).map((c) => c.label);
  const suffix = conventions.length > top.length ? `, +${conventions.length - top.length} more` : '';
  return ` Remembered: ${top.join('; ')}${suffix}.`;
}

function severityCost(severity: 'critical' | 'error' | 'warning' | 'info' | 'hint'): number {
  switch (severity) {
    case 'critical':
      return 2.8;
    case 'error':
      return 2.0;
    case 'warning':
      return 1.25;
    case 'info':
      return 0.6;
    case 'hint':
    default:
      return 0.4;
  }
}
