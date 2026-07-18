import type { InstructionDocument, InstructionRule, SourceReference } from '../contracts';
import { createSourceReference } from '../attribution/index';
import { discoverContextDocuments } from '../instructions/discover';
import { createInstructionResolver } from '../instructions/resolver';
import { chunkMarkdownByHeadings, extractInstructionTexts } from '../instructions/markdown-sections';
import { sha256 } from '../rag/hash';
import * as fs from 'fs/promises';
import * as path from 'path';

/**
 * Discover instruction / memory documents under the workspace.
 * Prefer {@link createInstructionResolver} for scoped resolution.
 */
export async function discoverInstructionDocuments(
  workspaceRoot: string,
  options: { configuredPaths?: readonly string[]; contextDirectory?: string } = {}
): Promise<InstructionDocument[]> {
  const docs = await discoverContextDocuments({
    workspaceRoot,
    configuredPaths: options.configuredPaths,
    contextDirectory: options.contextDirectory,
  });
  const workspaceId = sha256(path.resolve(workspaceRoot)).slice(0, 16);

  const out: InstructionDocument[] = [];
  for (const doc of docs) {
    let content = '';
    let fingerprint = '';
    try {
      content = await fs.readFile(path.join(workspaceRoot, doc.path), 'utf8');
      fingerprint = sha256(content);
    } catch {
      continue;
    }
    const sections = chunkMarkdownByHeadings(doc.path, content);
    const rules: InstructionRule[] = [];
    for (const section of sections) {
      for (const item of extractInstructionTexts(section)) {
        const source: SourceReference = createSourceReference({
          workspaceId,
          path: doc.path,
          startLine: item.startLine,
          endLine: item.endLine,
          sourceType: 'instruction',
          sourceFingerprint: fingerprint,
          excerpt: item.text.slice(0, 200),
          extraction: 'deterministic',
        });
        rules.push({
          id: `rule:${doc.path}:${item.startLine}`,
          text: item.text,
          source,
        });
      }
    }
    const source: SourceReference = createSourceReference({
      workspaceId,
      path: doc.path,
      startLine: doc.startLine,
      endLine: doc.endLine,
      sourceType: 'instruction',
      sourceFingerprint: fingerprint,
      excerpt: content.slice(0, 200),
      extraction: 'deterministic',
    });
    out.push({
      id: doc.id,
      path: doc.path,
      title: doc.title,
      kind:
        doc.documentType === 'instruction'
          ? 'agents'
          : doc.documentType === 'architecture' || doc.documentType === 'decision'
            ? 'architecture'
            : doc.documentType === 'convention'
              ? 'rules'
              : doc.path.toLowerCase().includes('readme')
                ? 'readme'
                : 'other',
      rules,
      source,
    });
  }
  return out;
}

export { createInstructionResolver, discoverContextDocuments };
