import * as fs from 'fs/promises';
import * as path from 'path';
import { fingerprintFile, loadProvenanceGraph } from './provenance';
import type { ProvenanceGraph } from './types';
import type { MemorySourceRef, MemoryStatus, ProvenanceDocumentNode } from './types';
import { parseMemoryDocument } from './frontmatter-memory';
import { GENERATED_DIR } from './paths';

export interface StaleCheckResult {
  readonly path: string;
  readonly status: MemoryStatus;
  readonly stale: boolean;
  readonly reasons: readonly string[];
  readonly missingSources: readonly string[];
  readonly changedSources: readonly string[];
}

/**
 * A memory document is stale when any cited source fingerprint no longer
 * matches the current file, or the source file was deleted.
 */
export async function detectStaleDocument(
  workspaceRoot: string,
  doc: ProvenanceDocumentNode
): Promise<StaleCheckResult> {
  const missing: string[] = [];
  const changed: string[] = [];
  const reasons: string[] = [];

  const allSources = uniqueSources(doc);
  for (const src of allSources) {
    const abs = path.join(workspaceRoot, src.path);
    let exists = true;
    try {
      await fs.access(abs);
    } catch {
      exists = false;
    }
    if (!exists) {
      missing.push(src.path);
      reasons.push(`missing-source:${src.path}`);
      continue;
    }
    if (!src.fingerprint) {
      reasons.push(`missing-fingerprint:${src.path}`);
      changed.push(src.path);
      continue;
    }
    const current = await fingerprintFile(workspaceRoot, src.path);
    if (!current || current !== src.fingerprint) {
      changed.push(src.path);
      reasons.push(`fingerprint-mismatch:${src.path}`);
    }
  }

  const stale =
    doc.status === 'stale' ||
    missing.length > 0 ||
    changed.length > 0;

  return {
    path: doc.path,
    status: stale && doc.status !== 'rejected' ? 'stale' : doc.status,
    stale: stale && doc.status !== 'rejected',
    reasons,
    missingSources: missing,
    changedSources: changed,
  };
}

export async function detectAllStale(
  workspaceRoot: string,
  graph?: ProvenanceGraph
): Promise<readonly StaleCheckResult[]> {
  const g = graph ?? (await loadProvenanceGraph(workspaceRoot));
  const out: StaleCheckResult[] = [];
  for (const doc of g.documents) {
    if (doc.status === 'rejected') continue;
    out.push(await detectStaleDocument(workspaceRoot, doc));
  }
  return out;
}

/**
 * Scan generated markdown files and mark provenance entries stale when sources drift.
 */
export async function scanGeneratedMemoryForStale(
  workspaceRoot: string
): Promise<readonly StaleCheckResult[]> {
  const graph = await loadProvenanceGraph(workspaceRoot);
  const fromGraph = await detectAllStale(workspaceRoot, graph);

  // Also check on-disk generated docs not yet in graph
  const genRoot = path.join(workspaceRoot, GENERATED_DIR);
  const extra: StaleCheckResult[] = [];
  await walkMd(genRoot, GENERATED_DIR, async (rel) => {
    if (graph.documents.some((d) => d.path === rel)) return;
    const abs = path.join(workspaceRoot, rel);
    let content: string;
    try {
      content = await fs.readFile(abs, 'utf8');
    } catch {
      return;
    }
    const parsed = parseMemoryDocument(content);
    if (!parsed.frontmatter) return;
    const synthetic: ProvenanceDocumentNode = {
      path: rel,
      status: parsed.frontmatter.status,
      confidence: parsed.frontmatter.confidence,
      generatedAt: parsed.frontmatter.generatedAt,
      claims: [
        {
          id: `claim:${rel}:body`,
          text: parsed.body.slice(0, 200),
          sources: parsed.frontmatter.sources,
        },
      ],
    };
    extra.push(await detectStaleDocument(workspaceRoot, synthetic));
  });

  return [...fromGraph, ...extra];
}

function uniqueSources(doc: ProvenanceDocumentNode): MemorySourceRef[] {
  const map = new Map<string, MemorySourceRef>();
  for (const claim of doc.claims) {
    for (const s of claim.sources) {
      map.set(`${s.path}:${s.startLine}:${s.endLine}`, s);
    }
  }
  return [...map.values()];
}

async function walkMd(
  abs: string,
  relBase: string,
  onFile: (rel: string) => Promise<void>
): Promise<void> {
  let entries: Array<{ name: string; isDirectory(): boolean; isFile(): boolean }>;
  try {
    entries = (await fs.readdir(abs, { withFileTypes: true })) as Array<{
      name: string;
      isDirectory(): boolean;
      isFile(): boolean;
    }>;
  } catch {
    return;
  }
  for (const entry of entries) {
    const name = String(entry.name);
    const childRel = `${relBase}/${name}`.replace(/\\/g, '/');
    const childAbs = path.join(abs, name);
    if (entry.isDirectory()) {
      if (name === 'rag') continue;
      await walkMd(childAbs, childRel, onFile);
    } else if (entry.isFile() && name.toLowerCase().endsWith('.md')) {
      await onFile(childRel);
    }
  }
}
