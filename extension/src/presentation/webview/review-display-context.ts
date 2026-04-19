import type { ProjectProfile } from '@mergecore/intelligence';
import type { ReviewRequest } from '../../domain/review-types';

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
    if (parts.length > 0) {
      return parts.join(' · ');
    }
  }
  return stackLineFromLanguageAndPath(request.languageId, request.filePath);
}

function stackPartsFromProfile(p: ProjectProfile): string[] {
  const out: string[] = [];
  const sig = new Set(p.signals);
  const php = p.stacks.php;
  const js = p.stacks.javascript;

  const add = (label: string): void => {
    if (!out.includes(label)) {
      out.push(label);
    }
  };

  if (sig.has('laravel') || php.isLaravel) {
    add('Laravel');
  }
  if (sig.has('filament') || php.filament) {
    add('Filament');
  }
  if (sig.has('livewire') || php.livewire) {
    add('Livewire');
  }
  if (sig.has('pest') || php.pest) {
    add('Pest');
  }
  if (sig.has('phpunit') || php.phpunit) {
    add('PHPUnit');
  }
  if (sig.has('typescript') || js.typeScript) {
    add('TypeScript');
  }
  if (sig.has('react') || js.react) {
    add('React');
  }
  if (sig.has('vue') || js.vue) {
    add('Vue');
  }
  if (sig.has('vite') || js.vite) {
    add('Vite');
  }
  if (sig.has('inertia') || js.inertia) {
    add('Inertia');
  }

  return out;
}

function stackLineFromLanguageAndPath(languageId: string, filePath: string): string {
  const fp = filePath.replace(/\\/g, '/').toLowerCase();
  if (fp.includes('/filament/')) {
    return 'Laravel · Filament';
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
