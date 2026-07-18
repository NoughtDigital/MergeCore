import { resolve } from 'node:path';
import {
  NestedIgnoreResolver,
  evaluatePathPrivacy,
  redactChunkTextForPrivacy,
  resolveInsideWorkspace,
  type PrivacyClassification,
  type PrivacyDecision,
} from '@mergecore/intelligence';
import { resolveWorkspaceRoot } from './workspace.js';
import { errorResult } from './errors.js';

/**
 * Explicit user configuration is required before an external MCP client
 * may access the index: MERGECORE_WORKSPACE and/or MERGECORE_ALLOWED_ROOTS.
 */
export function assertWorkspacePermitted():
  | { ok: true; workspaceRoot: string }
  | { ok: false; response: ReturnType<typeof errorResult> } {
  const hasWorkspace = Boolean(process.env.MERGECORE_WORKSPACE?.trim());
  const hasAllowed = Boolean(process.env.MERGECORE_ALLOWED_ROOTS?.trim());
  if (!hasWorkspace && !hasAllowed) {
    return {
      ok: false,
      response: errorResult(
        'workspace_not_permitted',
        'Set MERGECORE_WORKSPACE (or MERGECORE_ALLOWED_ROOTS) before using MergeCore MCP. Use “MergeCore: Copy MCP Client Config” in the extension.',
        { hint: 'mergecore.copyMcpConfig' }
      ),
    };
  }

  const workspaceRoot = resolveWorkspaceRoot();
  if (hasAllowed) {
    const allowed = parseAllowedRoots(process.env.MERGECORE_ALLOWED_ROOTS!);
    const normalised = resolve(workspaceRoot);
    const ok = allowed.some(
      (root) => normalised === root || normalised.startsWith(root + '/')
    );
    if (!ok) {
      return {
        ok: false,
        response: errorResult(
          'workspace_not_permitted',
          `Workspace ${normalised} is not in MERGECORE_ALLOWED_ROOTS.`,
          { workspaceRoot: normalised, allowedRoots: allowed }
        ),
      };
    }
  }

  return { ok: true, workspaceRoot };
}

function parseAllowedRoots(raw: string): string[] {
  return raw
    .split(/[:;,]/)
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => resolve(s));
}

/**
 * Resolve a relative/absolute path inside the workspace; reject traversal.
 */
export async function safeRelPath(
  workspaceRoot: string,
  input: string
): Promise<
  | { ok: true; rel: string }
  | { ok: false; response: ReturnType<typeof errorResult> }
> {
  if (!input?.trim()) {
    return {
      ok: false,
      response: errorResult('malformed_request', 'Path argument is required.'),
    };
  }
  const rel = await resolveInsideWorkspace(workspaceRoot, input);
  if (!rel) {
    return {
      ok: false,
      response: errorResult(
        'workspace_not_permitted',
        `Path escapes workspace or is invalid: ${input}`
      ),
    };
  }
  return { ok: true, rel };
}

/**
 * Drop gitignored / mergecoreignored paths from outbound MCP hit lists.
 * Privacy classifications that block model evidence are redacted separately.
 */
export async function filterIgnoredPaths(
  workspaceRoot: string,
  paths: readonly string[]
): Promise<string[]> {
  const resolver = new NestedIgnoreResolver(workspaceRoot);
  const out: string[] = [];
  for (const p of paths) {
    const normalised = p.replace(/\\/g, '/');
    const decision = await resolver.decide(normalised, false);
    if (!decision.ignored) {
      out.push(normalised);
    }
  }
  return out;
}

/**
 * Paths allowed for model/MCP evidence text (never_send / local_only excluded).
 */
export async function filterPathsForModelEvidence(
  workspaceRoot: string,
  paths: readonly string[]
): Promise<string[]> {
  const out: string[] = [];
  for (const p of paths) {
    const normalised = p.replace(/\\/g, '/');
    const privacy = await evaluatePathPrivacy({
      workspaceRoot,
      relPath: normalised,
    });
    if (privacy.allowsModelEvidence) {
      out.push(normalised);
    }
  }
  return out;
}

export async function privacyDecisionForPath(
  workspaceRoot: string,
  relPath: string
): Promise<PrivacyDecision> {
  return evaluatePathPrivacy({ workspaceRoot, relPath });
}

export function redactExcerptForPrivacy(
  text: string | undefined,
  classification: PrivacyClassification | undefined
): string | undefined {
  if (text === undefined) {
    return undefined;
  }
  return redactChunkTextForPrivacy(text, classification);
}
