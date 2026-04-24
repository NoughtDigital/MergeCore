import type { DetectorContext } from '../context';
import { addConvention, countFilesMatching, countPathMatches, describeCount, tierByCount } from './helpers';

/**
 * Repository pattern — projects that abstract persistence behind a
 * `Repository` layer instead of calling the ORM / query builder from
 * controllers and services. Works across PHP (Eloquent), TS (Prisma,
 * TypeORM), Python (SQLAlchemy) and similar.
 */
export async function detectRepositories(ctx: DetectorContext): Promise<void> {
  const [dirCount, suffixFiles] = await Promise.all([
    countPathMatches(ctx, ['/repositories/']),
    ctx
      .listFiles(['repository.', 'repositories'], 400)
      .then((files) =>
        files.filter((rel) => /[A-Za-z0-9_]+Repository\.(php|ts|tsx|kt|cs|java|py|go)$/.test(rel))
      ),
  ]);
  const count = dirCount + suffixFiles.length;
  const confidence = tierByCount(count, 4, 2);
  if (!confidence) {
    return;
  }

  const hasInterfaces = await countFilesMatching(
    ctx,
    suffixFiles,
    /\binterface\s+[A-Z][A-Za-z0-9_]*Repository\b|\babstract\s+class\s+[A-Z][A-Za-z0-9_]*Repository\b/,
    20
  );

  addConvention(ctx, {
    id: 'arch:repository-pattern',
    label: 'Uses Repository pattern to isolate persistence',
    confidence,
    category: 'architecture',
    evidence: [
      `${describeCount(count, 'repository file')}`,
      hasInterfaces.matched > 0
        ? `${hasInterfaces.matched} abstract/interface-based (scan of ${hasInterfaces.scanned})`
        : 'concrete classes only',
    ],
  });
}
