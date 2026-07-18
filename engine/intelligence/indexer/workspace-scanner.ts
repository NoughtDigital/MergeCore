import * as fs from 'fs/promises';
import * as path from 'path';
import type { ExclusionRecord, ExclusionReason } from '../contracts/types';
import { NestedIgnoreResolver, resolveInsideWorkspace } from '../ignore';
import { RAG_WALK_EXCLUDE, indexPriority } from '../rag/walk';

const DEFAULT_MAX_FILE_BYTES = 400_000;
const WALK_HARD_LIMIT = 12_000;

const INDEX_EXTENSIONS = new Set([
  '.ts',
  '.tsx',
  '.js',
  '.jsx',
  '.mjs',
  '.cjs',
  '.mts',
  '.cts',
  '.json',
  '.md',
  '.markdown',
  '.php',
  '.vue',
  '.yml',
  '.yaml',
  '.env.example',
  '.cursorrules',
  '.blade.php',
]);

const INDEX_BASENAMES = new Set([
  'composer.json',
  'package.json',
  'artisan',
  '.cursorrules',
  'AGENTS.md',
  'agents.md',
  'README.md',
  'readme.md',
]);

const BINARY_EXTENSIONS = new Set([
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.webp',
  '.ico',
  '.pdf',
  '.zip',
  '.gz',
  '.tar',
  '.woff',
  '.woff2',
  '.ttf',
  '.eot',
  '.mp4',
  '.mp3',
  '.wasm',
  '.exe',
  '.dll',
  '.so',
  '.dylib',
]);

const TEMP_FILE_RE =
  /(?:^|\/)(?:\.\#.*|.*~$|.*\.tmp$|.*\.temp$|.*\.swp$|.*\.partial$|.*\.bak$)$/i;

export interface ScanOptions {
  readonly workspaceRoot: string;
  readonly debugExclusions?: boolean;
  readonly maxFiles?: number;
  readonly signal?: AbortSignal;
}

export interface ScanResult {
  readonly files: readonly string[];
  readonly exclusions: readonly ExclusionRecord[];
}

export function isTempPath(relPath: string): boolean {
  const normalised = relPath.replace(/\\/g, '/');
  const base = normalised.split('/').pop() ?? normalised;
  if (TEMP_FILE_RE.test(normalised) || TEMP_FILE_RE.test(base)) {
    return true;
  }
  // VS Code / editors often use ~ suffix during atomic saves
  if (base.includes('.tmp.') || base.endsWith('~')) {
    return true;
  }
  return false;
}

export function isBinaryExtension(relPath: string): boolean {
  const base = relPath.replace(/\\/g, '/').split('/').pop()?.toLowerCase() ?? '';
  if (base.endsWith('.blade.php')) {
    return false;
  }
  const dot = base.lastIndexOf('.');
  if (dot < 0) {
    return false;
  }
  return BINARY_EXTENSIONS.has(base.slice(dot));
}

export function isSupportedIndexPath(relPath: string): boolean {
  if (isTempPath(relPath) || isBinaryExtension(relPath)) {
    return false;
  }
  const normalised = relPath.replace(/\\/g, '/');
  const base = normalised.split('/').pop() ?? normalised;
  if (INDEX_BASENAMES.has(base)) {
    return true;
  }
  const lower = normalised.toLowerCase();
  if (lower.endsWith('.blade.php')) {
    return true;
  }
  const dot = base.lastIndexOf('.');
  if (dot < 0) {
    return false;
  }
  return INDEX_EXTENSIONS.has(base.slice(dot).toLowerCase());
}

export function languageForPath(relPath: string): string {
  const lower = relPath.replace(/\\/g, '/').toLowerCase();
  if (lower.endsWith('.ts') || lower.endsWith('.tsx') || lower.endsWith('.mts') || lower.endsWith('.cts')) {
    return 'typescript';
  }
  if (
    lower.endsWith('.js') ||
    lower.endsWith('.jsx') ||
    lower.endsWith('.mjs') ||
    lower.endsWith('.cjs')
  ) {
    return 'javascript';
  }
  if (lower.endsWith('.md') || lower.endsWith('.markdown')) {
    return 'markdown';
  }
  if (lower.endsWith('.php') || lower.endsWith('.blade.php')) {
    return 'php';
  }
  if (lower.endsWith('.json')) {
    return 'json';
  }
  if (lower.endsWith('.vue')) {
    return 'vue';
  }
  return 'generic';
}

export function recordExclusion(
  list: ExclusionRecord[],
  enabled: boolean,
  pathRel: string,
  reason: ExclusionReason,
  detail?: string
): void {
  if (!enabled) {
    return;
  }
  list.push({ path: pathRel, reason, detail });
}

/**
 * Walk the workspace with nested ignore rules, default excludes, symlink safety,
 * and optional exclusion diagnostics.
 */
export async function scanWorkspace(options: ScanOptions): Promise<ScanResult> {
  const workspaceRoot = path.resolve(options.workspaceRoot);
  const debug = options.debugExclusions === true;
  const maxFiles = options.maxFiles ?? WALK_HARD_LIMIT;
  const exclusions: ExclusionRecord[] = [];
  const out: string[] = [];
  const resolver = new NestedIgnoreResolver(workspaceRoot);

  let rootReal = workspaceRoot;
  try {
    rootReal = await fs.realpath(workspaceRoot);
  } catch {
    rootReal = workspaceRoot;
  }

  async function outside(abs: string): Promise<boolean> {
    try {
      const real = await fs.realpath(abs);
      const rel = path.relative(rootReal, real);
      return rel.startsWith('..') || path.isAbsolute(rel);
    } catch {
      return true;
    }
  }

  async function recurse(dirRel: string): Promise<void> {
    if (options.signal?.aborted) {
      return;
    }
    if (out.length >= maxFiles) {
      return;
    }
    let entries: Array<{
      name: string;
      isDirectory(): boolean;
      isFile(): boolean;
      isSymbolicLink(): boolean;
    }>;
    try {
      entries = (await fs.readdir(path.join(workspaceRoot, dirRel), {
        withFileTypes: true,
      })) as Array<{
        name: string;
        isDirectory(): boolean;
        isFile(): boolean;
        isSymbolicLink(): boolean;
      }>;
    } catch {
      return;
    }

    for (const entry of entries) {
      if (options.signal?.aborted || out.length >= maxFiles) {
        return;
      }
      if (entry.name === '.DS_Store') {
        continue;
      }
      const rel = dirRel ? `${dirRel}/${entry.name}` : entry.name;
      const normalised = rel.replace(/\\/g, '/');
      const abs = path.join(workspaceRoot, rel);

      if (entry.isSymbolicLink()) {
        if (await outside(abs)) {
          recordExclusion(exclusions, debug, normalised, 'symlink-escape');
          continue;
        }
      }

      if (entry.isDirectory()) {
        if (entry.name === '.mergecore') {
          await recurse(rel);
          continue;
        }
        if (RAG_WALK_EXCLUDE.has(entry.name) || (entry.name.startsWith('.') && entry.name !== '.mergecore')) {
          recordExclusion(exclusions, debug, normalised, 'default-exclude', entry.name);
          continue;
        }
        const dirDecision = await resolver.decide(normalised, true);
        if (dirDecision.ignored) {
          recordExclusion(
            exclusions,
            debug,
            normalised,
            dirDecision.reason ?? 'gitignore',
            dirDecision.detail
          );
          continue;
        }
        await recurse(rel);
        continue;
      }

      if (!entry.isFile()) {
        continue;
      }

      if (isTempPath(normalised)) {
        recordExclusion(exclusions, debug, normalised, 'temp-file');
        continue;
      }
      if (isBinaryExtension(normalised)) {
        recordExclusion(exclusions, debug, normalised, 'binary');
        continue;
      }
      if (!isSupportedIndexPath(normalised)) {
        recordExclusion(exclusions, debug, normalised, 'unsupported');
        continue;
      }

      const fileDecision = await resolver.decide(normalised, false);
      if (fileDecision.ignored) {
        recordExclusion(
          exclusions,
          debug,
          normalised,
          fileDecision.reason ?? 'gitignore',
          fileDecision.detail
        );
        continue;
      }

      if (await outside(abs)) {
        recordExclusion(exclusions, debug, normalised, 'symlink-escape');
        continue;
      }

      out.push(normalised);
    }
  }

  await recurse('');
  out.sort((a, b) => indexPriority(b) - indexPriority(a) || a.localeCompare(b));
  return { files: out, exclusions };
}

/**
 * Decide whether a single relative path should be indexed (for incremental updates).
 */
export async function evaluatePathForIndex(
  workspaceRoot: string,
  relPath: string,
  options: { debugExclusions?: boolean; maxFileBytes?: number } = {}
): Promise<{
  readonly include: boolean;
  readonly exclusion?: ExclusionRecord;
}> {
  const normalised = relPath.replace(/\\/g, '/');
  const debug = options.debugExclusions === true;
  const maxBytes = options.maxFileBytes ?? DEFAULT_MAX_FILE_BYTES;

  if (isTempPath(normalised)) {
    const exclusion: ExclusionRecord = { path: normalised, reason: 'temp-file' };
    return { include: false, exclusion: debug ? exclusion : undefined };
  }
  if (isBinaryExtension(normalised)) {
    const exclusion: ExclusionRecord = { path: normalised, reason: 'binary' };
    return { include: false, exclusion: debug ? exclusion : undefined };
  }
  if (!isSupportedIndexPath(normalised)) {
    const exclusion: ExclusionRecord = { path: normalised, reason: 'unsupported' };
    return { include: false, exclusion: debug ? exclusion : undefined };
  }

  const parts = normalised.split('/');
  for (const part of parts) {
    if (RAG_WALK_EXCLUDE.has(part) && part !== 'rag') {
      // allow .mergecore memory; rag store itself is under .mergecore/rag
      if (part === 'rag' && normalised.includes('.mergecore/')) {
        const exclusion: ExclusionRecord = {
          path: normalised,
          reason: 'default-exclude',
          detail: 'rag',
        };
        return { include: false, exclusion: debug ? exclusion : undefined };
      }
      if (RAG_WALK_EXCLUDE.has(part) && part !== '.mergecore') {
        const exclusion: ExclusionRecord = {
          path: normalised,
          reason: 'default-exclude',
          detail: part,
        };
        return { include: false, exclusion: debug ? exclusion : undefined };
      }
    }
  }
  if (normalised.includes('.mergecore/rag/')) {
    const exclusion: ExclusionRecord = {
      path: normalised,
      reason: 'default-exclude',
      detail: 'rag-store',
    };
    return { include: false, exclusion: debug ? exclusion : undefined };
  }
  for (const part of parts.slice(0, -1)) {
    if (RAG_WALK_EXCLUDE.has(part)) {
      const exclusion: ExclusionRecord = {
        path: normalised,
        reason: 'default-exclude',
        detail: part,
      };
      return { include: false, exclusion: debug ? exclusion : undefined };
    }
  }

  const inside = await resolveInsideWorkspace(workspaceRoot, normalised);
  if (inside === undefined) {
    const exclusion: ExclusionRecord = { path: normalised, reason: 'symlink-escape' };
    return { include: false, exclusion: debug ? exclusion : undefined };
  }

  const resolver = new NestedIgnoreResolver(workspaceRoot);
  const decision = await resolver.decide(normalised, false);
  if (decision.ignored) {
    const exclusion: ExclusionRecord = {
      path: normalised,
      reason: decision.reason ?? 'gitignore',
      detail: decision.detail,
    };
    return { include: false, exclusion: debug ? exclusion : undefined };
  }

  try {
    const st = await fs.stat(path.join(workspaceRoot, normalised));
    if (st.size > maxBytes) {
      const exclusion: ExclusionRecord = {
        path: normalised,
        reason: 'oversized',
        detail: `${st.size}>${maxBytes}`,
      };
      return { include: false, exclusion: debug ? exclusion : undefined };
    }
  } catch {
    // missing — caller handles delete
  }

  return { include: true };
}

export { DEFAULT_MAX_FILE_BYTES };
