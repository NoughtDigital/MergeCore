import * as fs from 'fs/promises';
import * as path from 'path';
import {
  parseMemoryDocument,
  serialiseMemoryDocument,
} from './frontmatter-memory';
import {
  attachFingerprints,
  claimsFromSources,
  isSelfReinforcingClaim,
  loadProvenanceGraph,
  removeProvenanceDocument,
  saveProvenanceGraph,
  setDocumentStatus,
  upsertProvenanceDocument,
  validateProvenanceDocument,
} from './provenance';
import { detectStaleDocument, scanGeneratedMemoryForStale } from './stale';
import type { MemoryFrontmatter, MemoryStatus, ProvenanceDocumentNode } from './types';
import { MEMORY_SCHEMA_VERSION } from './types';
import { GENERATED_MEMORY_DIR, isUnderShareableMemoryDir } from './paths';

export interface WriteGeneratedMemoryInput {
  readonly workspaceRoot: string;
  readonly relativePath: string;
  readonly body: string;
  readonly sources: MemoryFrontmatter['sources'];
  readonly confidence?: number;
  readonly status?: MemoryStatus;
  readonly claimTexts?: readonly string[];
}

export interface WriteGeneratedMemoryResult {
  readonly path: string;
  readonly ok: boolean;
  readonly errors: readonly string[];
}

/**
 * Write a generated memory markdown file with frontmatter + provenance.
 * Refuses self-citing-only sources. Never writes into shareable human memory/.
 */
export async function writeGeneratedMemoryDocument(
  input: WriteGeneratedMemoryInput
): Promise<WriteGeneratedMemoryResult> {
  const rel = input.relativePath.replace(/\\/g, '/');
  if (isUnderShareableMemoryDir(rel)) {
    return {
      path: rel,
      ok: false,
      errors: ['refuses-overwrite-human-memory'],
    };
  }
  if (!rel.startsWith('.mergecore/generated/')) {
    return {
      path: rel,
      ok: false,
      errors: ['must-write-under-generated'],
    };
  }
  if (isSelfReinforcingClaim(input.sources)) {
    return {
      path: rel,
      ok: false,
      errors: ['self-cite-only'],
    };
  }

  const sources = await attachFingerprints(input.workspaceRoot, input.sources);
  const frontmatter: MemoryFrontmatter = {
    generatedBy: 'mergecore',
    generatedAt: new Date().toISOString(),
    schemaVersion: MEMORY_SCHEMA_VERSION,
    status: input.status ?? 'generated',
    confidence: input.confidence,
    sources,
    fields: {},
  };

  const claimTexts =
    input.claimTexts && input.claimTexts.length > 0
      ? input.claimTexts
      : [input.body.slice(0, 280).trim() || 'Generated memory claim'];

  const docNode: ProvenanceDocumentNode = {
    path: rel,
    status: frontmatter.status,
    confidence: frontmatter.confidence,
    generatedAt: frontmatter.generatedAt,
    claims: claimsFromSources(rel, claimTexts, sources),
  };
  const validation = validateProvenanceDocument(docNode);
  if (!validation.ok) {
    return { path: rel, ok: false, errors: validation.errors };
  }

  const abs = path.join(input.workspaceRoot, rel);
  await fs.mkdir(path.dirname(abs), { recursive: true });

  // Preserve human-authored sections if regenerating an existing file
  let body = input.body;
  try {
    const existing = await fs.readFile(abs, 'utf8');
    body = mergePreservingHumanSections(existing, input.body);
  } catch {
    // new file
  }

  await fs.writeFile(abs, serialiseMemoryDocument(frontmatter, body), 'utf8');

  const graph = await loadProvenanceGraph(input.workspaceRoot);
  await saveProvenanceGraph(
    input.workspaceRoot,
    upsertProvenanceDocument(graph, docNode)
  );

  return { path: rel, ok: true, errors: [] };
}

/**
 * Preserve blocks marked `<!-- mergecore:human -->` … `<!-- /mergecore:human -->`
 * from the existing file when regenerating.
 */
export function mergePreservingHumanSections(
  existingContent: string,
  generatedBody: string
): string {
  const existing = parseMemoryDocument(existingContent);
  const humanBlocks = extractHumanBlocks(existing.body);
  if (humanBlocks.length === 0) {
    return generatedBody;
  }
  const preserved = humanBlocks.join('\n\n');
  if (generatedBody.includes('<!-- mergecore:human -->')) {
    return generatedBody;
  }
  return `${generatedBody.trimEnd()}\n\n${preserved}\n`;
}

function extractHumanBlocks(body: string): string[] {
  const re =
    /<!--\s*mergecore:human\s*-->[\s\S]*?<!--\s*\/mergecore:human\s*-->/gi;
  return body.match(re) ?? [];
}

export async function updateMemoryStatusOnDisk(
  workspaceRoot: string,
  relPath: string,
  status: MemoryStatus
): Promise<{ ok: boolean; error?: string }> {
  const abs = path.join(workspaceRoot, relPath);
  let content: string;
  try {
    content = await fs.readFile(abs, 'utf8');
  } catch {
    return { ok: false, error: 'file-not-found' };
  }
  const parsed = parseMemoryDocument(content);
  if (!parsed.frontmatter) {
    return { ok: false, error: 'missing-frontmatter' };
  }
  if (parsed.malformed && parsed.errors.length > 0) {
    // Still allow status updates on recoverable docs
  }
  const next = serialiseMemoryDocument(
    { ...parsed.frontmatter, status },
    parsed.body
  );
  await fs.writeFile(abs, next, 'utf8');
  const graph = await loadProvenanceGraph(workspaceRoot);
  await saveProvenanceGraph(
    workspaceRoot,
    setDocumentStatus(graph, relPath, status)
  );
  return { ok: true };
}

export async function deleteMemoryDocument(
  workspaceRoot: string,
  relPath: string
): Promise<void> {
  const abs = path.join(workspaceRoot, relPath);
  try {
    await fs.unlink(abs);
  } catch {
    // ignore
  }
  const graph = await loadProvenanceGraph(workspaceRoot);
  await saveProvenanceGraph(
    workspaceRoot,
    removeProvenanceDocument(graph, relPath)
  );
}

/**
 * Mark stale docs in provenance + on-disk frontmatter. Optionally delete or regenerate.
 */
export async function refreshStaleMemory(
  workspaceRoot: string,
  options: { deleteStale?: boolean; regenerate?: boolean } = {}
): Promise<{
  readonly stale: readonly string[];
  readonly refreshed: readonly string[];
  readonly deleted: readonly string[];
}> {
  const results = await scanGeneratedMemoryForStale(workspaceRoot);
  const stalePaths = results.filter((r) => r.stale).map((r) => r.path);
  const refreshed: string[] = [];
  const deleted: string[] = [];

  for (const rel of stalePaths) {
    if (options.deleteStale) {
      await deleteMemoryDocument(workspaceRoot, rel);
      deleted.push(rel);
      continue;
    }

    await updateMemoryStatusOnDisk(workspaceRoot, rel, 'stale');

    if (options.regenerate) {
      const abs = path.join(workspaceRoot, rel);
      let content = '';
      try {
        content = await fs.readFile(abs, 'utf8');
      } catch {
        continue;
      }
      const parsed = parseMemoryDocument(content);
      if (!parsed.frontmatter) continue;

      // Drop missing sources; require at least one surviving external source
      const surviving = [];
      for (const s of parsed.frontmatter.sources) {
        try {
          await fs.access(path.join(workspaceRoot, s.path));
          surviving.push(s);
        } catch {
          // deleted source
        }
      }
      if (surviving.length === 0 || isSelfReinforcingClaim(surviving)) {
        await deleteMemoryDocument(workspaceRoot, rel);
        deleted.push(rel);
        continue;
      }

      const result = await writeGeneratedMemoryDocument({
        workspaceRoot,
        relativePath: rel,
        body: parsed.body,
        sources: surviving,
        confidence: parsed.frontmatter.confidence,
        status: 'generated',
      });
      if (result.ok) refreshed.push(rel);
    }
  }

  return { stale: stalePaths, refreshed, deleted };
}

export async function listGeneratedMemoryFiles(
  workspaceRoot: string
): Promise<readonly string[]> {
  const root = path.join(workspaceRoot, GENERATED_MEMORY_DIR);
  const out: string[] = [];
  async function walk(abs: string, rel: string): Promise<void> {
    let entries;
    try {
      entries = await fs.readdir(abs, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const childRel = `${rel}/${e.name}`.replace(/\\/g, '/');
      if (e.isDirectory()) await walk(path.join(abs, e.name), childRel);
      else if (e.name.toLowerCase().endsWith('.md')) out.push(childRel);
    }
  }
  await walk(root, GENERATED_MEMORY_DIR);
  return out.sort();
}

export { detectStaleDocument, scanGeneratedMemoryForStale };
