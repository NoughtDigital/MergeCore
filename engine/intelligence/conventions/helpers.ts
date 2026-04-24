import type { DetectorContext } from '../context';
import type { ProjectConvention } from '../types';

/**
 * Small utilities shared by convention detectors.
 *
 * The design goal is that each detector stays a ~30 line function: it asks
 * the context for file counts / contents / dependency hits, decides on a
 * confidence, and records a single convention. No pack knowledge lives here.
 */

export function addConvention(
  ctx: DetectorContext,
  convention: ProjectConvention
): void {
  ctx.conventions.push(convention);
}

/**
 * Count files whose path matches ALL of the given lowercase substrings.
 * Uses the cached workspace walk so repeated detectors share work.
 */
export async function countPathMatches(
  ctx: DetectorContext,
  substrings: readonly string[]
): Promise<number> {
  if (substrings.length === 0) {
    return 0;
  }
  const firstPass = await ctx.listFiles(substrings.slice(0, 1), 1000);
  if (firstPass.length === 0 || substrings.length === 1) {
    return firstPass.length;
  }
  const needles = substrings.map((s) => s.toLowerCase());
  let n = 0;
  for (const rel of firstPass) {
    const lower = rel.toLowerCase();
    if (needles.every((needle) => lower.includes(needle))) {
      n += 1;
    }
  }
  return n;
}

/**
 * Returns true if any of the passed file relative paths contain the given
 * regex somewhere in their content. Short-circuits on first hit. Kept
 * intentionally conservative (one regex, bounded scan) — deep static
 * analysis is the pipeline's job, not ours.
 */
export async function anyFileMatches(
  ctx: DetectorContext,
  files: readonly string[],
  regex: RegExp,
  maxFiles = 40
): Promise<boolean> {
  for (const rel of files.slice(0, maxFiles)) {
    const content = await ctx.readUtf8(rel);
    if (content && regex.test(content)) {
      return true;
    }
  }
  return false;
}

/**
 * Counts how many of the passed files contain the regex. Useful when a
 * single positive hit is ambiguous but a sustained majority is a strong
 * signal (e.g. "most tests use Pest style", "most actions have a handle").
 */
export async function countFilesMatching(
  ctx: DetectorContext,
  files: readonly string[],
  regex: RegExp,
  maxFiles = 40
): Promise<{ matched: number; scanned: number }> {
  let matched = 0;
  const slice = files.slice(0, maxFiles);
  for (const rel of slice) {
    const content = await ctx.readUtf8(rel);
    if (content && regex.test(content)) {
      matched += 1;
    }
  }
  return { matched, scanned: slice.length };
}

export function describeCount(n: number, singular: string, plural?: string): string {
  const word = n === 1 ? singular : plural ?? `${singular}s`;
  return `${n} ${word}`;
}

/**
 * Turn a raw file count into a confidence tier. The thresholds are low on
 * purpose — a small project with three Action classes is still clearly
 * using the Actions pattern; raising the bar would punish early-stage code.
 */
export function tierByCount(
  count: number,
  high: number,
  medium: number = 1
): ProjectConvention['confidence'] | undefined {
  if (count >= high) {
    return 'high';
  }
  if (count >= medium) {
    return 'medium';
  }
  return undefined;
}
