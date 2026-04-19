import { collectProjectProfile, type ProjectProfile } from '@mergecore/intelligence';

const cache = new Map<string, { expires: number; profile: ProjectProfile }>();
const TTL_MS = 30_000;

export async function getProjectProfileCached(workspaceRoot: string): Promise<ProjectProfile> {
  const now = Date.now();
  const hit = cache.get(workspaceRoot);
  if (hit && hit.expires > now) {
    return hit.profile;
  }
  const profile = await collectProjectProfile(workspaceRoot);
  cache.set(workspaceRoot, { expires: now + TTL_MS, profile });
  return profile;
}

export function clearProjectProfileCache(workspaceRoot?: string): void {
  if (workspaceRoot === undefined) {
    cache.clear();
    return;
  }
  cache.delete(workspaceRoot);
}
