import {
  createRepositoryFileIndexer,
  STORE_SCHEMA_VERSION,
  type RepositoryFileIndexer,
  type RagStore,
} from '@mergecore/intelligence';
import { errorResult, logMeta } from './errors.js';
import { assertWorkspacePermitted } from './security.js';

export interface OpenedIndex {
  readonly workspaceRoot: string;
  readonly indexer: RepositoryFileIndexer;
  readonly store: RagStore;
  close(): Promise<void>;
}

/**
 * Open the shared workspace index (same default `.mergecore/rag` as the extension).
 * Does not create a parallel store.
 */
export async function openSharedIndex(tool: string): Promise<
  | { ok: true; opened: OpenedIndex }
  | { ok: false; response: ReturnType<typeof errorResult> }
> {
  const permitted = assertWorkspacePermitted();
  if (!permitted.ok) return permitted;

  const workspaceRoot = permitted.workspaceRoot;
  logMeta(tool, workspaceRoot);

  try {
    const indexer = await createRepositoryFileIndexer({
      workspaceRoot,
      debugExclusions: true,
    });
    const store = indexer.getRagStore();
    return {
      ok: true,
      opened: {
        workspaceRoot,
        indexer,
        store,
        async close() {
          await indexer.dispose();
        },
      },
    };
  } catch (err) {
    return {
      ok: false,
      response: errorResult(
        'index_unavailable',
        `Failed to open shared index for ${workspaceRoot}: ${err instanceof Error ? err.message : String(err)}`
      ),
    };
  }
}

export async function requireNonEmptyIndex(
  opened: OpenedIndex
): Promise<ReturnType<typeof errorResult> | undefined> {
  if (opened.store.chunkCount === 0) {
    return errorResult(
      'index_unavailable',
      'Local MergeCore index is empty. Run mergecore_index / Index Repository first.',
      {
        workspaceRoot: opened.workspaceRoot,
        storeDir: opened.store.storeDirectory,
        schemaVersion: STORE_SCHEMA_VERSION,
      }
    );
  }
  return undefined;
}

export { STORE_SCHEMA_VERSION };
