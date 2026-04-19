import type { DetectorContext } from './context';
import { detectComposer } from './detectors/composer.detector';
import { detectPackageJson } from './detectors/package-json.detector';
import { detectPathSignals } from './detectors/path-signals.detector';

export type ProjectDetector = (ctx: DetectorContext) => Promise<void>;

/**
 * Order matters: path hints run first so filesystem signals can reinforce composer.json.
 * Add new detectors by importing them and appending here.
 */
export const PROJECT_DETECTORS: readonly ProjectDetector[] = [
  detectPathSignals,
  detectComposer,
  detectPackageJson,
];
