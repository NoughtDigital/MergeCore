import * as fs from 'fs/promises';
import * as path from 'path';
import { CONTEXT_PACKS_DIR } from '../memory/paths';
import type { TaskContextPack } from './task-context-types';
import {
  compactTimestamp,
  metaToFrontmatter,
  serialiseTaskContextDocument,
  slugifyTask,
  parseTaskContextFrontmatter,
} from './task-context-frontmatter';

export interface WriteTaskContextPackResult {
  readonly absolutePath: string;
  readonly relativePath: string;
}

/**
 * Persist a task context pack under `.mergecore/generated/context-packs/`.
 */
export async function writeTaskContextPack(
  workspaceRoot: string,
  pack: TaskContextPack
): Promise<WriteTaskContextPackResult> {
  const relDir = CONTEXT_PACKS_DIR;
  const filename = `${compactTimestamp(pack.meta.generatedAt)}-${slugifyTask(pack.meta.task)}.md`;
  const relativePath = `${relDir}/${filename}`.replace(/\\/g, '/');
  const absolutePath = path.join(workspaceRoot, relativePath);
  await fs.mkdir(path.dirname(absolutePath), { recursive: true });
  const doc = serialiseTaskContextDocument(
    metaToFrontmatter(pack.meta),
    pack.markdown
  );
  await fs.writeFile(absolutePath, doc, 'utf8');
  return { absolutePath, relativePath };
}

export { parseTaskContextFrontmatter, slugifyTask, compactTimestamp };
