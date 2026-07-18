import * as fs from 'fs';
import * as path from 'path';

export interface WipeLocalIndexOptions {
  readonly includeGenerated?: boolean;
  readonly includeShareableMemory?: boolean;
}

export interface WipeLocalIndexResult {
  readonly deletedRag: boolean;
  readonly deletedGenerated: boolean;
  readonly deletedMemory: boolean;
  readonly errors: readonly string[];
}

/**
 * Delete on-disk MergeCore local index directories.
 * Never deletes memory unless `includeShareableMemory` is true.
 */
export async function wipeMergeCoreLocalData(
  workspaceRoot: string,
  options: WipeLocalIndexOptions = {}
): Promise<WipeLocalIndexResult> {
  const errors: string[] = [];
  const ragDir = path.join(workspaceRoot, '.mergecore', 'rag');
  const generatedDir = path.join(workspaceRoot, '.mergecore', 'generated');
  const memoryDir = path.join(workspaceRoot, '.mergecore', 'memory');

  let deletedRag = false;
  let deletedGenerated = false;
  let deletedMemory = false;

  try {
    if (fs.existsSync(ragDir)) {
      await fs.promises.rm(ragDir, { recursive: true, force: true });
      deletedRag = true;
    }
  } catch (err) {
    errors.push(
      `Failed to delete RAG index: ${err instanceof Error ? err.message : String(err)}`
    );
  }

  if (options.includeGenerated) {
    try {
      if (fs.existsSync(generatedDir)) {
        await fs.promises.rm(generatedDir, { recursive: true, force: true });
        deletedGenerated = true;
      }
    } catch (err) {
      errors.push(
        `Failed to delete generated data: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }

  if (options.includeShareableMemory) {
    try {
      if (fs.existsSync(memoryDir)) {
        await fs.promises.rm(memoryDir, { recursive: true, force: true });
        deletedMemory = true;
      }
    } catch (err) {
      errors.push(
        `Failed to delete shareable memory: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }

  return { deletedRag, deletedGenerated, deletedMemory, errors };
}
