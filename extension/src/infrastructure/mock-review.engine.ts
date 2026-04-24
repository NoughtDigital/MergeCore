import type { ReviewEngine } from '../application/ports/review-engine.port';
import type { ReviewRequest, ReviewResult } from '../domain/review-types';

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

export class MockReviewEngine implements ReviewEngine {
  async review(request: ReviewRequest): Promise<ReviewResult> {
    const findings = [];

    if (/\b(eval|exec|shell_exec|child_process\.exec)\s*\(/i.test(request.content)) {
      findings.push({
        id: 'mock-dynamic-exec',
        severity: 'warning' as const,
        message: 'Dynamic execution can be risky; ensure untrusted input cannot reach it.',
        whyItMatters:
          'Runtime execution APIs can turn validation gaps into command or code injection issues across stacks.',
        fixHint: 'Prefer a narrow API, allowlisted commands, or structured library calls.',
        line: undefined,
        category: 'security',
        code: 'MERGECORE_DYNAMIC_EXEC',
      });
    }

    if (/\b(TODO|FIXME)\b/.test(request.content)) {
      findings.push({
        id: 'mock-open-work',
        severity: 'hint' as const,
        message: 'Open TODO/FIXME marker left in reviewed code.',
        whyItMatters:
          'Outstanding markers make review intent ambiguous and can hide unfinished behaviour.',
        fixHint: 'Resolve the marker or link it to tracked follow-up work.',
        category: 'maintainability',
        code: 'MERGECORE_OPEN_WORK',
      });
    }

    const seed = `${request.filePath}\0${request.content.slice(0, 4000)}`;
    const h = fnv1a32(seed);
    const jitter = (h % 10000) / 10000 - 0.5;
    const raw = 9.34 - findings.length * 1.25 + jitter * 0.36;
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

    return {
      findings,
      score,
      summary: baseSummary + profileHint + contextHint,
      improvedCode: undefined,
      patch: undefined,
    };
  }
}
