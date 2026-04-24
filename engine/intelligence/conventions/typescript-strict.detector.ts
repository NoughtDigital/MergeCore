import type { DetectorContext } from '../context';
import { addConvention } from './helpers';

/**
 * TypeScript strictness — treats `"strict": true` (or the explicit mix of
 * noImplicitAny + strictNullChecks) as a codebase-level convention. New
 * files that opt out of strict typing in a strict repo are a clear
 * critique signal.
 */
export async function detectTypescriptStrictness(ctx: DetectorContext): Promise<void> {
  if (!ctx.javascript.typeScript) {
    return;
  }

  const tsconfig = await ctx.readUtf8('tsconfig.json');
  if (!tsconfig) {
    return;
  }

  let parsed: Record<string, unknown> | undefined;
  try {
    parsed = JSON.parse(stripJsonComments(tsconfig)) as Record<string, unknown>;
  } catch {
    return;
  }
  const compilerOptions = asObject(parsed['compilerOptions']);
  if (!compilerOptions) {
    return;
  }

  const strict = compilerOptions['strict'] === true;
  const noImplicitAny = compilerOptions['noImplicitAny'] === true;
  const strictNullChecks = compilerOptions['strictNullChecks'] === true;
  const exactOptional = compilerOptions['exactOptionalPropertyTypes'] === true;
  const noUncheckedIndexed = compilerOptions['noUncheckedIndexedAccess'] === true;

  if (strict || (noImplicitAny && strictNullChecks)) {
    const extras: string[] = [];
    if (exactOptional) {
      extras.push('exactOptionalPropertyTypes');
    }
    if (noUncheckedIndexed) {
      extras.push('noUncheckedIndexedAccess');
    }
    addConvention(ctx, {
      id: 'types:typescript-strict',
      label: 'Uses strict TypeScript (strict: true) — new code must stay strict',
      confidence: extras.length > 0 ? 'high' : 'medium',
      category: 'types',
      evidence: [
        strict ? 'compilerOptions.strict: true' : 'noImplicitAny + strictNullChecks enabled',
        extras.length > 0 ? `also enabled: ${extras.join(', ')}` : 'baseline strict only',
      ],
    });
  }
}

function stripJsonComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1')
    .replace(/,\s*([}\]])/g, '$1');
}

function asObject(v: unknown): Record<string, unknown> | undefined {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : undefined;
}
