export { collectProjectProfile } from './collect';
export type { DetectorContext } from './context';
export type {
  ProjectProfile,
  ProjectConvention,
  PhpStackInfo,
  JavascriptStackInfo,
} from './types';
export { PROJECT_DETECTORS, type ProjectDetector } from './registry';
export {
  CONVENTION_DETECTORS,
  type ConventionDetector,
} from './conventions/registry';
