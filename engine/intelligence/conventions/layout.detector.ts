import type { DetectorContext } from '../context';
import { addConvention, countPathMatches, describeCount, tierByCount } from './helpers';

/**
 * Layout / module shape — whether the repo organises by domain/feature
 * folders ("Billing/", "Users/") or by kind/role ("Controllers/",
 * "Services/"). Both are legitimate; the convention exists so reviewers
 * can flag the odd one out — a new kind-based folder in a
 * feature-organised codebase is a red flag and vice versa.
 */
export async function detectDomainLayout(ctx: DetectorContext): Promise<void> {
  const [controllers, services, repositories, actions, models] = await Promise.all([
    countPathMatches(ctx, ['/controllers/']),
    countPathMatches(ctx, ['/services/']),
    countPathMatches(ctx, ['/repositories/']),
    countPathMatches(ctx, ['/actions/']),
    countPathMatches(ctx, ['/models/']),
  ]);
  const kindTotal = controllers + services + repositories + actions + models;

  const [modules, features, domains] = await Promise.all([
    countPathMatches(ctx, ['/modules/']),
    countPathMatches(ctx, ['/features/']),
    countPathMatches(ctx, ['/domain/', '/domains/']),
  ]);
  const featureTotal = modules + features + domains;

  if (featureTotal >= Math.max(8, kindTotal)) {
    const confidence = tierByCount(featureTotal, 20, 8);
    if (!confidence) {
      return;
    }
    addConvention(ctx, {
      id: 'layout:feature-folders',
      label: 'Organises code by feature/domain modules (not by role)',
      confidence,
      category: 'layering',
      evidence: [
        `${describeCount(modules + features, 'feature file')}`,
        `${describeCount(domains, 'domain file')}`,
        `${describeCount(kindTotal, 'role-based file')} (minority)`,
      ],
    });
    return;
  }

  if (kindTotal >= 10) {
    const confidence = tierByCount(kindTotal, 25, 10);
    if (!confidence) {
      return;
    }
    addConvention(ctx, {
      id: 'layout:role-based',
      label: 'Organises code by role (Controllers/, Services/, Models/, …)',
      confidence,
      category: 'layering',
      evidence: [
        `${describeCount(controllers, 'controller file')}`,
        `${describeCount(services, 'service file')}`,
        `${describeCount(repositories, 'repository file')}`,
        `${describeCount(actions, 'action file')}`,
        `${describeCount(models, 'model file')}`,
      ],
    });
  }
}
