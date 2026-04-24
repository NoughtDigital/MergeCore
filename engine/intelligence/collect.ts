import { CONVENTION_DETECTORS } from './conventions/registry';
import { createDetectorContext, finalizeProfile } from './context';
import { PROJECT_DETECTORS } from './registry';
import type { ProjectProfile } from './types';

/**
 * Two passes run over the same detector context:
 *  1. Stack detectors (composer, package.json, path signals) populate the
 *     typed stack info so downstream detectors can trust those flags.
 *  2. Convention detectors (the "contextual memory" pass) walk the
 *     workspace once and record repeated patterns.
 *
 * Everything stays in one context so adding a new pack requires at most
 * one new detector — no changes to this function.
 */
export async function collectProjectProfile(workspaceRoot: string): Promise<ProjectProfile> {
  const ctx = createDetectorContext(workspaceRoot);
  for (const run of PROJECT_DETECTORS) {
    await run(ctx);
  }
  for (const run of CONVENTION_DETECTORS) {
    try {
      await run(ctx);
    } catch {
      // A failing convention detector must never break the profile; it
      // just means that one memory is missing. Stack detection and all
      // other conventions still make it to the LLM.
    }
  }
  return finalizeProfile(ctx);
}
