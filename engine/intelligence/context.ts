import * as fs from 'fs/promises';
import * as path from 'path';
import type { JavascriptStackInfo, PhpStackInfo, ProjectProfile } from './types';
import { emptyJsStack, emptyPhpStack } from './types';

export interface DetectorContext {
  readonly workspaceRoot: string;
  readonly php: PhpStackInfo;
  readonly javascript: JavascriptStackInfo;
  /** Detectors append stable tags (e.g. path:artisan). */
  readonly extraSignals: string[];
  exists(rel: string): Promise<boolean>;
  readUtf8(rel: string): Promise<string | undefined>;
  readJson<T>(rel: string): Promise<T | undefined>;
}

export function createDetectorContext(workspaceRoot: string): DetectorContext {
  const php = emptyPhpStack();
  const javascript = emptyJsStack();
  const extraSignals: string[] = [];

  async function exists(rel: string): Promise<boolean> {
    try {
      await fs.access(path.join(workspaceRoot, rel));
      return true;
    } catch {
      return false;
    }
  }

  async function readUtf8(rel: string): Promise<string | undefined> {
    try {
      return await fs.readFile(path.join(workspaceRoot, rel), 'utf8');
    } catch {
      return undefined;
    }
  }

  async function readJson<T>(rel: string): Promise<T | undefined> {
    const raw = await readUtf8(rel);
    if (raw === undefined) {
      return undefined;
    }
    try {
      return JSON.parse(raw) as T;
    } catch {
      return undefined;
    }
  }

  return {
    workspaceRoot,
    php,
    javascript,
    extraSignals,
    exists,
    readUtf8,
    readJson,
  };
}

function collectSignals(php: PhpStackInfo, js: JavascriptStackInfo, extra: string[]): string[] {
  const s = new Set<string>(extra);
  if (php.hasComposerJson) {
    s.add('php:composer');
  }
  if (php.isLaravel) {
    s.add('laravel');
  }
  if (php.filament) {
    s.add('filament');
  }
  if (php.livewire) {
    s.add('livewire');
  }
  if (php.pest) {
    s.add('pest');
  }
  if (php.phpunit) {
    s.add('phpunit');
  }
  if (js.hasPackageJson) {
    s.add('js:package-json');
  }
  if (js.typeScript) {
    s.add('typescript');
  }
  if (js.react) {
    s.add('react');
  }
  if (js.vue) {
    s.add('vue');
  }
  if (js.vite) {
    s.add('vite');
  }
  if (js.inertia) {
    s.add('inertia');
  }
  return [...s].sort((a, b) => a.localeCompare(b));
}

function buildFingerprint(signals: readonly string[]): string {
  return signals.join('|') || 'generic';
}

export function finalizeProfile(ctx: DetectorContext): ProjectProfile {
  const signals = collectSignals(ctx.php, ctx.javascript, ctx.extraSignals);
  return {
    workspaceRoot: ctx.workspaceRoot,
    collectedAt: Date.now(),
    stacks: {
      php: { ...ctx.php },
      javascript: { ...ctx.javascript },
    },
    signals,
    fingerprint: buildFingerprint(signals),
  };
}
