import type { DetectorContext } from '../context';
import { addConvention, countPathMatches, describeCount, tierByCount } from './helpers';

/**
 * Typed request objects — dedicated request/validation classes that the
 * controller type-hints instead of raw `$request->all()` / `req.body`.
 * Examples: Laravel FormRequest (`*Request.php`), Zod schemas under
 * `/schemas/`, Pydantic models under `/models/` / `/schemas/`.
 *
 * A new PR that reads input straight off the raw request in a codebase
 * with a typed-request convention is a direct critique.
 */
export async function detectTypedRequests(ctx: DetectorContext): Promise<void> {
  const laravelRequests = await ctx
    .listFiles(['/requests/'], 300)
    .then((files) => files.filter((rel) => /Request\.php$/.test(rel)).length);

  const zodSchemas = await ctx
    .listFiles(['/schemas/', '/validation/'], 300)
    .then((files) => files.filter((rel) => /\.(ts|tsx|js|mjs)$/.test(rel)).length);

  const pydanticModels = await countPathMatches(ctx, ['/schemas/']);

  const total = laravelRequests + zodSchemas + pydanticModels;
  const confidence = tierByCount(total, 4, 2);
  if (!confidence) {
    return;
  }

  const evidence: string[] = [];
  if (laravelRequests > 0) {
    evidence.push(`${describeCount(laravelRequests, 'FormRequest class')}`);
  }
  if (zodSchemas > 0) {
    evidence.push(`${describeCount(zodSchemas, 'schema file')} under /schemas or /validation`);
  }
  if (pydanticModels > 0 && !zodSchemas) {
    evidence.push(`${describeCount(pydanticModels, 'file')} under /schemas (python)`);
  }

  addConvention(ctx, {
    id: 'data:typed-requests',
    label: 'Validates inputs with typed request / schema objects, not raw bags',
    confidence,
    category: 'data',
    evidence,
  });
}
