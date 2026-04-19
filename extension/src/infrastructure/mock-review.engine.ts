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
  laravel: 'Laravel',
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
  'path:laravel-skeleton': 'Laravel layout',
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
    const isPhp = request.languageId === 'php' || request.filePath.endsWith('.php');
    const findings = [];

    if (isPhp && /DB::raw\s*\(/i.test(request.content)) {
      findings.push({
        id: 'mock-raw-sql',
        severity: 'warning' as const,
        message: 'Raw SQL via DB::raw can be risky; ensure bindings are used.',
        whyItMatters:
          'Unparameterised raw SQL is a common source of SQL injection when user input reaches the expression.',
        fixHint: 'Prefer the query builder, or use parameter binding with whereRaw/bind.',
        line: undefined,
        category: 'security',
        code: 'MERGECORE_RAW_SQL',
      });
    }

    if (isPhp && /\$request->all\s*\(\)/.test(request.content)) {
      findings.push({
        id: 'mock-mass-assign',
        severity: 'warning' as const,
        message: 'Mass assignment from $request->all() can be dangerous; prefer validated input.',
        whyItMatters:
          'Hidden attributes can be mass-assigned if your model is not perfectly guarded, which can escalate privileges.',
        fixHint: 'Use Form Request validated arrays or explicit DTO mapping.',
        category: 'security',
        code: 'MERGECORE_MASS_ASSIGN',
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
        : 'This is a mock review so you can try the flow without an account. Add mergecore.apiToken in settings and set mergecore.useMockReviewer to false for the real senior-style reviewer.';
    const stackPhrase = request.projectProfile?.fingerprint
      ? formatFingerprintForSummary(request.projectProfile.fingerprint)
      : '';
    const profileHint = stackPhrase
      ? ` Workspace looks like: ${stackPhrase}.`
      : '';

    return {
      findings,
      score,
      summary: baseSummary + profileHint,
      improvedCode: undefined,
      patch: undefined,
    };
  }
}
