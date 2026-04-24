import type { DetectorContext } from '../context';
import { addConvention, countPathMatches, describeCount, tierByCount } from './helpers';

/**
 * DTO usage — projects that keep a `*Dto.php`, `*DTO.ts`, `*Data.php`
 * (Spatie laravel-data), or `/dto/` / `/dtos/` / `/data/` folder. This
 * detector deliberately accepts several naming schemes because team
 * preferences vary and reviews should follow whichever one the repo
 * already uses.
 */
export async function detectDtos(ctx: DetectorContext): Promise<void> {
  const [dtoDir, dtosDir, dataDir, dtoSuffix] = await Promise.all([
    countPathMatches(ctx, ['/dto/']),
    countPathMatches(ctx, ['/dtos/']),
    countPathMatches(ctx, ['/data/']),
    ctx
      .listFiles(['dto.', 'data.'], 500)
      .then((files) =>
        files.filter((rel) => /[A-Za-z0-9_]+(Dto|DTO|Data)\.(php|ts|tsx|kt|cs|java|py)$/.test(rel)).length
      ),
  ]);

  const count = dtoDir + dtosDir + dataDir + dtoSuffix;
  const confidence = tierByCount(count, 6, 2);
  if (!confidence) {
    return;
  }

  const evidence: string[] = [];
  if (dtoDir + dtosDir > 0) {
    evidence.push(`${describeCount(dtoDir + dtosDir, 'file')} under DTO/DTOs directory`);
  }
  if (dataDir > 0) {
    evidence.push(`${describeCount(dataDir, 'file')} under Data/ directory`);
  }
  if (dtoSuffix > 0) {
    evidence.push(`${describeCount(dtoSuffix, 'class')} with Dto/DTO/Data suffix`);
  }

  addConvention(ctx, {
    id: 'data:dtos',
    label: 'Uses DTOs / data objects to shape request and response payloads',
    confidence,
    category: 'data',
    evidence,
  });
}
