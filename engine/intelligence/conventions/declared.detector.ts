import type { DetectorContext } from '../context';
import type { ProjectConvention } from '../types';
import { addConvention } from './helpers';

/**
 * Team-declared conventions — the escape hatch that makes contextual
 * memory future-proof. Any project, any pack, any stack can drop a file
 * at one of:
 *
 *   - `.mergecore/conventions.json`
 *   - `.mergecore.conventions.json`
 *   - `mergecore.conventions.json`
 *
 * and the plugin will remember those conventions and critique against
 * them, even if no built-in detector knows the pattern. Example:
 *
 * ```json
 * {
 *   "conventions": [
 *     { "id": "ui:no-tailwind-arbitrary-values", "label": "Avoid arbitrary Tailwind values; extend theme instead", "category": "ui", "confidence": "high" },
 *     { "id": "api:pagination-is-cursor", "label": "All list endpoints are cursor-paginated, never offset" }
 *   ]
 * }
 * ```
 *
 * This detector is the glue between "packs the plugin knows about" and
 * "this team's own standards". It runs last so declared conventions win
 * when ids clash with a built-in detector's guess.
 */
interface DeclaredConventionsFile {
  readonly conventions?: readonly DeclaredConventionRaw[];
}

interface DeclaredConventionRaw {
  readonly id?: unknown;
  readonly label?: unknown;
  readonly confidence?: unknown;
  readonly category?: unknown;
  readonly evidence?: unknown;
}

const CANDIDATE_PATHS: readonly string[] = [
  '.mergecore/conventions.json',
  '.mergecore.conventions.json',
  'mergecore.conventions.json',
];

export async function detectDeclaredConventions(ctx: DetectorContext): Promise<void> {
  for (const rel of CANDIDATE_PATHS) {
    const parsed = await ctx.readJson<DeclaredConventionsFile>(rel);
    if (!parsed || !Array.isArray(parsed.conventions)) {
      continue;
    }
    for (const raw of parsed.conventions) {
      const convention = normaliseDeclared(raw, rel);
      if (convention) {
        addConvention(ctx, convention);
      }
    }
  }
}

function normaliseDeclared(
  raw: DeclaredConventionRaw,
  sourceFile: string
): ProjectConvention | undefined {
  if (typeof raw.id !== 'string' || raw.id.trim().length === 0) {
    return undefined;
  }
  if (typeof raw.label !== 'string' || raw.label.trim().length === 0) {
    return undefined;
  }
  const confidence = normaliseConfidence(raw.confidence);
  const category = normaliseCategory(raw.category);
  const evidence = normaliseEvidence(raw.evidence, sourceFile);
  return {
    id: raw.id.trim(),
    label: raw.label.trim(),
    confidence,
    category,
    evidence,
  };
}

function normaliseConfidence(v: unknown): ProjectConvention['confidence'] {
  if (v === 'high' || v === 'medium' || v === 'low') {
    return v;
  }
  return 'high';
}

function normaliseCategory(v: unknown): ProjectConvention['category'] {
  if (
    v === 'architecture' ||
    v === 'layering' ||
    v === 'naming' ||
    v === 'testing' ||
    v === 'types' ||
    v === 'data' ||
    v === 'ui' ||
    v === 'tooling' ||
    v === 'other'
  ) {
    return v;
  }
  return 'other';
}

function normaliseEvidence(v: unknown, sourceFile: string): readonly string[] {
  const declared = `declared in ${sourceFile}`;
  if (Array.isArray(v)) {
    const cleaned = v
      .filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
      .slice(0, 3);
    return [declared, ...cleaned];
  }
  return [declared];
}
