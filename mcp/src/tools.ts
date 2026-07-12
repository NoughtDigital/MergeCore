import {
  RagStore,
  collectProjectProfile,
  indexWorkspace,
  retrieveFromWorkspace,
  scanProdRisks,
  type ExplanationMode,
  type IntelligenceProfile,
} from '@mergecore/intelligence';
import {
  loadPackRegistry,
  readPackAgents,
  readPackManifest,
  locateRulesRegistry,
  resolveWorkspaceRoot,
} from './workspace.js';

function textResult(payload: unknown) {
  return {
    content: [
      {
        type: 'text' as const,
        text: typeof payload === 'string' ? payload : JSON.stringify(payload, null, 2),
      },
    ],
  };
}

function errorResult(message: string) {
  return {
    content: [{ type: 'text' as const, text: message }],
    isError: true,
  };
}

export async function toolIndexStatus() {
  const workspaceRoot = resolveWorkspaceRoot();
  try {
    const store = await RagStore.open(workspaceRoot);
    return textResult({
      workspaceRoot,
      chunkCount: store.chunkCount,
      fileCount: store.fileCount,
      hasSqlite: store.hasSqlite,
      storeDir: `${workspaceRoot}/.mergecore/rag`,
    });
  } catch (err) {
    return errorResult(
      `Failed to open RAG store for ${workspaceRoot}: ${err instanceof Error ? err.message : String(err)}`
    );
  }
}

export async function toolIndexRepository() {
  const workspaceRoot = resolveWorkspaceRoot();
  try {
    const profile = await collectProjectProfile(workspaceRoot);
    const isLaravel =
      profile.signals.includes('laravel') || profile.signals.includes('path:artisan');
    const result = await indexWorkspace({
      workspaceRoot,
      isLaravel,
      onProgress: (p) => {
        console.error(`[mergecore-mcp] ${p.phase}: ${p.message}`);
      },
    });
    return textResult({
      workspaceRoot,
      filesIndexed: result.filesIndexed,
      chunks: result.chunks,
      fingerprint: profile.fingerprint,
      signals: profile.signals,
      stacks: profile.stacks,
    });
  } catch (err) {
    return errorResult(
      `Index failed for ${workspaceRoot}: ${err instanceof Error ? err.message : String(err)}`
    );
  }
}

export async function toolRetrieve(args: {
  query: string;
  k?: number;
  pathHint?: string;
  mode?: ExplanationMode;
  profile?: IntelligenceProfile;
  preferMemory?: boolean;
}) {
  const workspaceRoot = resolveWorkspaceRoot();
  try {
    const hits = await retrieveFromWorkspace(workspaceRoot, args.query, {
      k: args.k ?? 8,
      pathHint: args.pathHint,
      mode: args.mode,
      profile: args.profile,
      preferMemory: args.preferMemory ?? true,
    });
    return textResult({
      workspaceRoot,
      query: args.query,
      hits: hits.map((h) => ({
        path: h.chunk.path,
        symbol: h.chunk.symbol,
        kind: h.chunk.kind,
        score: h.score,
        excerpt: h.chunk.text.slice(0, 500),
      })),
    });
  } catch (err) {
    return errorResult(
      `Retrieve failed for ${workspaceRoot}: ${err instanceof Error ? err.message : String(err)}`
    );
  }
}

export async function toolExplainContext(args: {
  symbol: string;
  filePath?: string;
  k?: number;
}) {
  const query = [args.symbol, args.filePath].filter(Boolean).join(' ');
  return toolRetrieve({
    query,
    k: args.k ?? 10,
    pathHint: args.filePath,
    preferMemory: true,
  });
}

export async function toolScanProdRisks(args: { files?: string[] }) {
  const workspaceRoot = resolveWorkspaceRoot();
  try {
    const profile = await collectProjectProfile(workspaceRoot);
    const registryPath = await locateRulesRegistry(workspaceRoot);
    const scan = await scanProdRisks({
      workspaceRoot,
      profile,
      rulesRegistryPath: registryPath,
      files: args.files,
      progress: {
        onFile: (_rel, index, total) => {
          if (index % 50 === 0) {
            console.error(`[mergecore-mcp] prod-risk ${index + 1}/${total}`);
          }
        },
      },
    });
    return textResult({
      workspaceRoot,
      registryPath: registryPath ?? null,
      scannedFiles: scan.scannedFiles,
      skippedFiles: scan.skippedFiles,
      durationMs: scan.durationMs,
      ruleSetFingerprint: scan.ruleSetFingerprint,
      activeRuleIds: scan.activeRuleIds,
      summary: scan.summary,
      findings: scan.findings.slice(0, 100),
      truncated: scan.findings.length > 100,
    });
  } catch (err) {
    return errorResult(
      `Prod-risk scan failed for ${workspaceRoot}: ${err instanceof Error ? err.message : String(err)}`
    );
  }
}

export async function toolListPacks() {
  const workspaceRoot = resolveWorkspaceRoot();
  try {
    const loaded = await loadPackRegistry(workspaceRoot);
    if (!loaded) {
      return textResult({
        workspaceRoot,
        packs: [],
        note: 'No rules/registry.json found. Built-in prod-risk rules still apply.',
      });
    }
    const packs = [];
    for (const pack of loaded.registry.packs) {
      const manifest = await readPackManifest(loaded.registryPath, pack);
      packs.push({
        id: pack.id,
        path: pack.path,
        version: pack.version,
        tags: pack.tags ?? [],
        suggested_when: pack.suggested_when ?? [],
        title: typeof manifest?.title === 'string' ? manifest.title : undefined,
      });
    }
    return textResult({
      workspaceRoot,
      registryPath: loaded.registryPath,
      registry_version: loaded.registry.registry_version,
      packs,
    });
  } catch (err) {
    return errorResult(
      `List packs failed for ${workspaceRoot}: ${err instanceof Error ? err.message : String(err)}`
    );
  }
}

export async function toolReadPackGuidance(args: { packId: string }) {
  const workspaceRoot = resolveWorkspaceRoot();
  try {
    const loaded = await loadPackRegistry(workspaceRoot);
    if (!loaded) {
      return errorResult('No rules/registry.json found in the workspace.');
    }
    const pack = loaded.registry.packs.find((p) => p.id === args.packId);
    if (!pack) {
      const ids = loaded.registry.packs.map((p) => p.id).join(', ');
      return errorResult(`Unknown packId "${args.packId}". Available: ${ids || '(none)'}`);
    }
    const agents = await readPackAgents(loaded.registryPath, pack);
    const manifest = await readPackManifest(loaded.registryPath, pack);
    return textResult({
      workspaceRoot,
      packId: pack.id,
      version: pack.version,
      path: pack.path,
      manifest,
      agentsMd: agents,
    });
  } catch (err) {
    return errorResult(
      `Read pack guidance failed: ${err instanceof Error ? err.message : String(err)}`
    );
  }
}

export async function toolWorkspaceProfile() {
  const workspaceRoot = resolveWorkspaceRoot();
  try {
    const profile = await collectProjectProfile(workspaceRoot);
    return textResult({
      workspaceRoot,
      collectedAt: profile.collectedAt,
      fingerprint: profile.fingerprint,
      stacks: profile.stacks,
      conventions: profile.conventions,
      signals: profile.signals.slice(0, 40),
    });
  } catch (err) {
    return errorResult(
      `Profile failed for ${workspaceRoot}: ${err instanceof Error ? err.message : String(err)}`
    );
  }
}
