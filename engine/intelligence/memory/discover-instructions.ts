import * as fs from 'fs/promises';
import * as path from 'path';
import type { InstructionDocument, InstructionRule, SourceReference } from '../contracts';
import { PRIORITY_MEMORY_BASENAMES } from '../rag/markdown-memory';
import { sha256 } from '../rag/hash';

function kindForBasename(base: string): InstructionDocument['kind'] {
  const lower = base.toLowerCase();
  if (lower === 'readme.md') return 'readme';
  if (lower === 'agents.md' || lower === 'agile.md') return 'agents';
  if (lower === '.cursorrules' || lower.includes('coding-standards')) return 'rules';
  if (lower === 'architecture.md' || lower === 'decisions.md') return 'architecture';
  return 'other';
}

function rulesFromMarkdown(filePath: string, content: string): InstructionRule[] {
  const lines = content.split(/\r?\n/);
  const rules: InstructionRule[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? '';
    const bullet = line.match(/^\s*[-*]\s+(.+)$/);
    const numbered = line.match(/^\s*\d+\.\s+(.+)$/);
    const text = (bullet?.[1] ?? numbered?.[1] ?? '').trim();
    if (!text || text.length < 8) {
      continue;
    }
    const source: SourceReference = {
      path: filePath,
      startLine: i + 1,
      endLine: i + 1,
      sourceType: 'instruction',
      excerpt: text.slice(0, 200),
    };
    rules.push({
      id: `rule:${sha256(`${filePath}:${i + 1}:${text}`).slice(0, 16)}`,
      text,
      source,
    });
    if (rules.length >= 40) {
      break;
    }
  }
  return rules;
}

/**
 * Discover instruction / memory documents under the workspace.
 */
export async function discoverInstructionDocuments(
  workspaceRoot: string
): Promise<InstructionDocument[]> {
  const docs: InstructionDocument[] = [];

  for (const name of PRIORITY_MEMORY_BASENAMES) {
    const candidates = [name, name.toLowerCase(), name.toUpperCase()];
    for (const candidate of candidates) {
      const abs = path.join(workspaceRoot, candidate);
      try {
        const content = await fs.readFile(abs, 'utf8');
        const rel = candidate.replace(/\\/g, '/');
        const base = rel.split('/').pop() ?? rel;
        const source: SourceReference = {
          path: rel,
          startLine: 1,
          endLine: Math.max(1, content.split(/\r?\n/).length),
          sourceType: 'instruction',
          excerpt: content.slice(0, 200),
        };
        docs.push({
          id: `instr:${rel}`,
          path: rel,
          title: base,
          kind: kindForBasename(base),
          rules: rulesFromMarkdown(rel, content),
          source,
        });
        break;
      } catch {
        // try next candidate
      }
    }
  }

  return docs;
}
