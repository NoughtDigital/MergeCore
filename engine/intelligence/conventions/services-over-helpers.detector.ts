import type { DetectorContext } from '../context';
import { addConvention, countPathMatches, describeCount } from './helpers';

/**
 * "Prefers services over helpers" — inferred by comparing the presence of
 * a Services layer against a Helpers/Utils/Lib grab-bag. We can't know the
 * team's stated preference, so we take the dominant directory as the
 * convention. If both are sizeable we still surface the ratio so reviews
 * can push back when a new file lands in the minority bucket.
 */
export async function detectServicesOverHelpers(ctx: DetectorContext): Promise<void> {
  const [services, helpers, utils] = await Promise.all([
    countPathMatches(ctx, ['/services/']),
    countPathMatches(ctx, ['/helpers/']),
    countPathMatches(ctx, ['/utils/']),
  ]);
  const loose = helpers + utils;

  if (services === 0 && loose === 0) {
    return;
  }

  if (services >= Math.max(3, loose * 2)) {
    addConvention(ctx, {
      id: 'layering:services-over-helpers',
      label: 'Prefers services over helpers/utils grab-bags',
      confidence: services >= 8 ? 'high' : 'medium',
      category: 'layering',
      evidence: [
        `${describeCount(services, 'service file')} in Services/`,
        `${describeCount(loose, 'file')} in Helpers//Utils/ (minority pattern)`,
      ],
    });
    return;
  }

  if (loose >= Math.max(3, services * 2)) {
    addConvention(ctx, {
      id: 'layering:helpers-and-utils',
      label: 'Relies on helper / util modules for cross-cutting logic',
      confidence: loose >= 8 ? 'high' : 'medium',
      category: 'layering',
      evidence: [
        `${describeCount(loose, 'file')} in Helpers/ / Utils/`,
        `${describeCount(services, 'service file')} (minority)`,
      ],
    });
    return;
  }

  if (services >= 3 && loose >= 3) {
    addConvention(ctx, {
      id: 'layering:services-and-helpers-mixed',
      label: 'Mixes Services/ and Helpers/Utils/ — review for consistency',
      confidence: 'medium',
      category: 'layering',
      evidence: [
        `${describeCount(services, 'service file')}`,
        `${describeCount(loose, 'helper/util file')}`,
      ],
    });
  }
}
