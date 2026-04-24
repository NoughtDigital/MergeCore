import * as fs from 'fs/promises';
import * as path from 'path';
import {
  isKnownProdRiskCategory,
  type ProdRiskCategory,
  type ProdRiskLanguage,
  type ProdRiskRule,
  type ProdRiskSeverity,
} from './types';

/**
 * Pack-contributed rules loader.
 *
 * Any rules pack can ship an optional `prod-risks.json` file alongside
 * its `rubric.json` / `smells.json`. The file is *data only* — the same
 * contract as `ProdRiskRule` — so packs never ship executable code into
 * the scanner.
 *
 * Missing, malformed, or empty files are tolerated: the built-in rule
 * set remains authoritative. This keeps the scanner future-proof as
 * packs evolve at their own cadence.
 */

const ALLOWED_SEVERITIES: readonly ProdRiskSeverity[] = [
  'critical',
  'error',
  'warning',
  'info',
  'hint',
];

interface RegistryEntry {
  readonly id: string;
  readonly path: string;
  readonly version?: string;
}

interface PackRegistry {
  readonly packs?: readonly RegistryEntry[];
}

interface PackManifest {
  readonly pack_id?: string;
  readonly version?: string;
  readonly artifacts?: Readonly<Record<string, string>>;
}

interface RawProdRiskRule {
  readonly id?: unknown;
  readonly ruleVersion?: unknown;
  readonly category?: unknown;
  readonly severity?: unknown;
  readonly title?: unknown;
  readonly description?: unknown;
  readonly fixHint?: unknown;
  readonly languages?: unknown;
  readonly requiredSignals?: unknown;
  readonly patterns?: unknown;
  readonly patternFlags?: unknown;
  readonly negativePatterns?: unknown;
  readonly filePathIncludes?: unknown;
  readonly filePathExcludes?: unknown;
  readonly tags?: unknown;
}

interface RawProdRiskDoc {
  readonly rules?: readonly RawProdRiskRule[];
}

/**
 * Discover and load all pack-contributed prod-risk rule files that live
 * next to {@link rulesRegistryPath}. Safe on any directory layout: if
 * the registry is absent the function returns an empty array.
 */
export async function loadPackProdRiskRules(
  rulesRegistryPath: string
): Promise<readonly ProdRiskRule[]> {
  const registry = await readJson<PackRegistry>(rulesRegistryPath);
  if (!registry?.packs?.length) {
    return [];
  }
  const rulesDir = path.dirname(rulesRegistryPath);
  const collected: ProdRiskRule[] = [];
  for (const entry of registry.packs) {
    if (!entry || typeof entry.id !== 'string' || typeof entry.path !== 'string') {
      continue;
    }
    const packDir = path.join(rulesDir, entry.path);
    const manifest = await readJson<PackManifest>(path.join(packDir, 'pack.json'));
    const packId = (manifest?.pack_id && typeof manifest.pack_id === 'string')
      ? manifest.pack_id
      : entry.id;

    // Prefer an explicit artifact entry when present; fall back to the
    // conventional filename. Either way, a missing file is a no-op.
    const artifactRel = typeof manifest?.artifacts?.prod_risks === 'string'
      ? manifest.artifacts.prod_risks
      : 'prod-risks.json';
    const artifactPath = path.join(packDir, artifactRel);
    const doc = await readJson<RawProdRiskDoc>(artifactPath);
    if (!doc || !Array.isArray(doc.rules)) {
      continue;
    }
    for (const raw of doc.rules) {
      const rule = coerceRule(raw, packId);
      if (rule) {
        collected.push(rule);
      }
    }
  }
  return collected;
}

async function readJson<T>(filePath: string): Promise<T | undefined> {
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    return JSON.parse(raw) as T;
  } catch {
    return undefined;
  }
}

/**
 * Validate and normalise one raw pack rule into a `ProdRiskRule`.
 *
 * We intentionally accept a permissive shape and coerce it, so packs
 * can be written by humans without strict TypeScript. Anything obviously
 * wrong (missing id, unknown category, zero patterns) is dropped
 * rather than thrown, preserving all the other rules.
 */
function coerceRule(raw: RawProdRiskRule, packId: string): ProdRiskRule | undefined {
  if (!raw || typeof raw !== 'object') {
    return undefined;
  }
  const id = typeof raw.id === 'string' ? raw.id.trim() : '';
  if (!id) {
    return undefined;
  }
  const category = typeof raw.category === 'string' ? raw.category : '';
  if (!isKnownProdRiskCategory(category)) {
    return undefined;
  }
  const severity = typeof raw.severity === 'string' ? raw.severity : 'warning';
  const normalisedSeverity: ProdRiskSeverity = ALLOWED_SEVERITIES.includes(
    severity as ProdRiskSeverity
  )
    ? (severity as ProdRiskSeverity)
    : 'warning';

  const title = typeof raw.title === 'string' ? raw.title : id;
  const description = typeof raw.description === 'string' ? raw.description : '';
  const fixHint = typeof raw.fixHint === 'string' ? raw.fixHint : '';
  const ruleVersion = typeof raw.ruleVersion === 'string' ? raw.ruleVersion : '1';
  const languages = asStringArray(raw.languages) as readonly ProdRiskLanguage[];
  if (languages.length === 0) {
    return undefined;
  }
  const patterns = asStringArray(raw.patterns);
  const negativePatterns = asStringArray(raw.negativePatterns);
  // A rule with no positive patterns and no path filter would match every
  // file it is allowed into — almost certainly an authoring mistake. Skip.
  const filePathIncludes = asStringArray(raw.filePathIncludes);
  if (patterns.length === 0 && filePathIncludes.length === 0) {
    return undefined;
  }
  return {
    id,
    ruleVersion,
    category: category as ProdRiskCategory,
    severity: normalisedSeverity,
    title,
    description,
    fixHint,
    origin: packId,
    languages,
    requiredSignals: asStringArray(raw.requiredSignals),
    patterns,
    patternFlags: typeof raw.patternFlags === 'string' ? raw.patternFlags : undefined,
    negativePatterns,
    filePathIncludes,
    filePathExcludes: asStringArray(raw.filePathExcludes),
    tags: asStringArray(raw.tags),
  };
}

function asStringArray(value: unknown): readonly string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const out: string[] = [];
  for (const item of value) {
    if (typeof item === 'string' && item.length > 0) {
      out.push(item);
    }
  }
  return out;
}
