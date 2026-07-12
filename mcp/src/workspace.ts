import { access, readFile, stat } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { constants as fsConstants } from 'node:fs';

export function resolveWorkspaceRoot(): string {
  const fromEnv = process.env.MERGECORE_WORKSPACE?.trim();
  if (fromEnv) {
    return resolve(fromEnv);
  }
  return resolve(process.cwd());
}

export async function locateRulesRegistry(workspaceRoot: string): Promise<string | undefined> {
  const candidates = [
    join(workspaceRoot, 'rules', 'registry.json'),
    join(workspaceRoot, '.mergecore', 'rules', 'registry.json'),
    join(workspaceRoot, 'mergecore', 'rules', 'registry.json'),
  ];
  for (const candidate of candidates) {
    try {
      const info = await stat(candidate);
      if (info.isFile()) {
        return candidate;
      }
    } catch {
      // keep looking
    }
  }
  return undefined;
}

export interface PackRegistryEntry {
  readonly id: string;
  readonly path: string;
  readonly version: string;
  readonly tags?: readonly string[];
  readonly suggested_when?: readonly string[];
}

export interface PackRegistry {
  readonly registry_version: string;
  readonly title?: string;
  readonly description?: string;
  readonly packs: readonly PackRegistryEntry[];
}

export async function loadPackRegistry(workspaceRoot: string): Promise<{
  registryPath: string;
  registry: PackRegistry;
} | null> {
  const registryPath = await locateRulesRegistry(workspaceRoot);
  if (!registryPath) {
    return null;
  }
  const raw = await readFile(registryPath, 'utf8');
  const registry = JSON.parse(raw) as PackRegistry;
  if (!Array.isArray(registry.packs)) {
    throw new Error(`Invalid registry at ${registryPath}: missing packs array`);
  }
  return { registryPath, registry };
}

export async function readPackAgents(
  registryPath: string,
  pack: PackRegistryEntry
): Promise<string | null> {
  const packDir = join(dirname(registryPath), pack.path);
  const agentsPath = join(packDir, 'agents.md');
  try {
    await access(agentsPath, fsConstants.R_OK);
    return await readFile(agentsPath, 'utf8');
  } catch {
    return null;
  }
}

export async function readPackManifest(
  registryPath: string,
  pack: PackRegistryEntry
): Promise<Record<string, unknown> | null> {
  const packDir = join(dirname(registryPath), pack.path);
  const manifestPath = join(packDir, 'pack.json');
  try {
    await access(manifestPath, fsConstants.R_OK);
    return JSON.parse(await readFile(manifestPath, 'utf8')) as Record<string, unknown>;
  } catch {
    return null;
  }
}
