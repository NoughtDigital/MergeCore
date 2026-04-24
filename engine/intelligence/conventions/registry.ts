import type { DetectorContext } from '../context';
import { detectActionsPattern, detectCommandsPattern } from './actions-pattern.detector';
import { detectDeclaredConventions } from './declared.detector';
import { detectDomainLayout } from './layout.detector';
import { detectDtos } from './dtos.detector';
import { detectRepositories } from './repositories.detector';
import { detectServicesOverHelpers } from './services-over-helpers.detector';
import { detectTestingStyle } from './testing-style.detector';
import { detectTypedRequests } from './typed-requests.detector';
import { detectTypescriptStrictness } from './typescript-strict.detector';

/**
 * A convention detector inspects the project context after stack
 * detection has run and records any conventions it finds. Detectors
 * MUST be side-effect free beyond `ctx.conventions`.
 */
export type ConventionDetector = (ctx: DetectorContext) => Promise<void>;

/**
 * Order matters: structural detectors run first, then more specialised
 * ones that may use stack flags set earlier, and finally the declared
 * detector so explicit team declarations win on id collisions.
 *
 * New packs add a detector here. Keep each detector tiny and focused
 * so the cost of running them all stays linear in the workspace walk.
 */
export const CONVENTION_DETECTORS: readonly ConventionDetector[] = [
  detectDomainLayout,
  detectActionsPattern,
  detectCommandsPattern,
  detectRepositories,
  detectServicesOverHelpers,
  detectDtos,
  detectTypedRequests,
  detectTestingStyle,
  detectTypescriptStrictness,
  detectDeclaredConventions,
];
