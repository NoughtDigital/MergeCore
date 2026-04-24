import type { ProjectProfile } from '@mergecore/intelligence';
import type { ReviewRequest } from '../../domain/review-types';

const SIGNAL_LABELS: Readonly<Record<string, string>> = {
  filament: 'Filament',
  inertia: 'Inertia',
  livewire: 'Livewire',
  pest: 'Pest',
  phpunit: 'PHPUnit',
  react: 'React',
  typescript: 'TypeScript',
  vite: 'Vite',
  vue: 'Vue',
  'js:package-json': 'Node',
  'php:composer': 'Composer',
  'path:php-app-layout': 'PHP app layout',
};

export interface ReviewDisplayInfo {
  readonly stackLine: string;
  readonly fileLabel: string;
}

export function buildReviewDisplayInfo(request: ReviewRequest): ReviewDisplayInfo {
  return {
    stackLine: stackLineFor(request),
    fileLabel: fileLabelFor(request),
  };
}

function fileLabelFor(request: ReviewRequest): string {
  if (request.scope === 'git-diff') {
    const hint = `${request.label} ${request.filePath}`.toLowerCase();
    if (hint.includes('staged')) {
      return 'Staged diff';
    }
    return 'Working tree diff';
  }
  const parts = request.filePath.split(/[/\\]/);
  const base = parts.pop() || request.label;
  return base || '—';
}

function stackLineFor(request: ReviewRequest): string {
  const p = request.projectProfile;
  if (p) {
    const parts = stackPartsFromProfile(p);
    const relatedCount = request.relatedContext?.files.length ?? 0;
    if (relatedCount > 0) {
      parts.push(`${relatedCount} related`);
    }
    if (parts.length > 0) {
      return parts.join(' · ');
    }
  }
  const fallback = stackLineFromLanguageAndPath(request.languageId, request.filePath);
  const relatedCount = request.relatedContext?.files.length ?? 0;
  return relatedCount > 0 ? `${fallback} · ${relatedCount} related` : fallback;
}

function stackPartsFromProfile(p: ProjectProfile): string[] {
  const out: string[] = [];
  const add = (label: string): void => {
    if (!out.includes(label)) {
      out.push(label);
    }
  };

  for (const signal of p.signals) {
    const label = SIGNAL_LABELS[signal] ?? labelFromSignal(signal);
    add(label);
  }

  return out;
}

function stackLineFromLanguageAndPath(languageId: string, filePath: string): string {
  const fp = filePath.replace(/\\/g, '/').toLowerCase();
  if (fp.includes('/filament/')) {
    return 'Filament';
  }
  if (languageId === 'diff') {
    return 'Git diff';
  }
  if (languageId === 'php') {
    return 'PHP';
  }

  const map: Record<string, string> = {
    typescript: 'TypeScript',
    javascript: 'JavaScript',
    typescriptreact: 'TypeScript · React',
    javascriptreact: 'JavaScript · React',
    vue: 'Vue',
    json: 'JSON',
    markdown: 'Markdown',
  };

  return map[languageId] ?? (languageId ? languageId : 'Code review');
}

function labelFromSignal(signal: string): string {
  const cleaned = signal.replace(/^(path|js|php):/, '').replace(/[-_]/g, ' ');
  return cleaned.replace(/\b\w/g, (m) => m.toUpperCase());
}
