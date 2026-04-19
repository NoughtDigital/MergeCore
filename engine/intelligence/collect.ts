import { createDetectorContext, finalizeProfile } from './context';
import { PROJECT_DETECTORS } from './registry';
import type { ProjectProfile } from './types';

export async function collectProjectProfile(workspaceRoot: string): Promise<ProjectProfile> {
  const ctx = createDetectorContext(workspaceRoot);
  for (const run of PROJECT_DETECTORS) {
    await run(ctx);
  }
  return finalizeProfile(ctx);
}
