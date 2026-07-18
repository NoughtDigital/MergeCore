import * as fs from 'fs/promises';
import * as path from 'path';
import { sha256 } from '../rag/hash';
import { PROVENANCE_PATH } from './paths';
import {
  MEMORY_SCHEMA_VERSION,
  type MemoryClaim,
  type MemorySourceRef,
  type MemoryStatus,
  type ProvenanceDocumentNode,
  type ProvenanceGraph,
} from './types';
import { isUnderGeneratedDir } from './paths';

export function emptyProvenanceGraph(now = new Date().toISOString()): ProvenanceGraph {
  return {
    schemaVersion: MEMORY_SCHEMA_VERSION,
    updatedAt: now,
    documents: [],
  };
}

export async function loadProvenanceGraph(
  workspaceRoot: string
): Promise<ProvenanceGraph> {
  const abs = path.join(workspaceRoot, PROVENANCE_PATH);
  try {
    const raw = await fs.readFile(abs, 'utf8');
    const parsed = JSON.parse(raw) as ProvenanceGraph;
    if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.documents)) {
      return emptyProvenanceGraph();
    }
    return {
      schemaVersion: parsed.schemaVersion ?? MEMORY_SCHEMA_VERSION,
      updatedAt: parsed.updatedAt ?? new Date().toISOString(),
      documents: parsed.documents,
    };
  } catch {
    return emptyProvenanceGraph();
  }
}

export async function saveProvenanceGraph(
  workspaceRoot: string,
  graph: ProvenanceGraph
): Promise<void> {
  const abs = path.join(workspaceRoot, PROVENANCE_PATH);
  await fs.mkdir(path.dirname(abs), { recursive: true });
  const next: ProvenanceGraph = {
    ...graph,
    schemaVersion: MEMORY_SCHEMA_VERSION,
    updatedAt: new Date().toISOString(),
  };
  await fs.writeFile(abs, `${JSON.stringify(next, null, 2)}\n`, 'utf8');
}

export function upsertProvenanceDocument(
  graph: ProvenanceGraph,
  doc: ProvenanceDocumentNode
): ProvenanceGraph {
  const others = graph.documents.filter((d) => d.path !== doc.path);
  return {
    ...graph,
    documents: [...others, doc].sort((a, b) => a.path.localeCompare(b.path)),
  };
}

export function removeProvenanceDocument(
  graph: ProvenanceGraph,
  relPath: string
): ProvenanceGraph {
  return {
    ...graph,
    documents: graph.documents.filter((d) => d.path !== relPath),
  };
}

export interface ProvenanceValidationResult {
  readonly ok: boolean;
  readonly errors: readonly string[];
}

/**
 * Validate provenance: every claim needs ≥1 non-generated source;
 * generated memory must never be the sole evidence for a fact.
 */
export function validateProvenanceDocument(
  doc: ProvenanceDocumentNode
): ProvenanceValidationResult {
  const errors: string[] = [];
  if (!doc.path) {
    errors.push('missing-path');
  }
  for (const claim of doc.claims) {
    if (!claim.id) errors.push('claim-missing-id');
    if (!claim.text?.trim()) errors.push(`claim-empty:${claim.id}`);
    if (!claim.sources || claim.sources.length === 0) {
      errors.push(`claim-no-sources:${claim.id}`);
      continue;
    }
    const external = claim.sources.filter((s) => !isGeneratedMemoryPath(s.path));
    if (external.length === 0) {
      errors.push(`self-cite-only:${claim.id}`);
    }
  }
  return { ok: errors.length === 0, errors };
}

export function validateProvenanceGraph(graph: ProvenanceGraph): ProvenanceValidationResult {
  const errors: string[] = [];
  for (const doc of graph.documents) {
    const r = validateProvenanceDocument(doc);
    errors.push(...r.errors);
  }
  return { ok: errors.length === 0, errors };
}

export function isGeneratedMemoryPath(relPath: string): boolean {
  const p = relPath.replace(/\\/g, '/');
  return isUnderGeneratedDir(p) || p.includes('.mergecore/generated/');
}

/** True when sources only point at MergeCore-generated memory (forbidden loop). */
export function isSelfReinforcingClaim(sources: readonly MemorySourceRef[]): boolean {
  if (sources.length === 0) return true;
  return sources.every((s) => isGeneratedMemoryPath(s.path));
}

export async function fingerprintFile(
  workspaceRoot: string,
  relPath: string
): Promise<string | undefined> {
  try {
    const content = await fs.readFile(path.join(workspaceRoot, relPath), 'utf8');
    return sha256(content);
  } catch {
    return undefined;
  }
}

export async function attachFingerprints(
  workspaceRoot: string,
  sources: readonly MemorySourceRef[]
): Promise<MemorySourceRef[]> {
  const out: MemorySourceRef[] = [];
  for (const s of sources) {
    const fingerprint = s.fingerprint ?? (await fingerprintFile(workspaceRoot, s.path));
    out.push({ ...s, fingerprint });
  }
  return out;
}

export function buildClaimId(docPath: string, text: string, index: number): string {
  return `claim:${sha256(`${docPath}|${index}|${text}`).slice(0, 16)}`;
}

export function claimsFromSources(
  docPath: string,
  texts: readonly string[],
  sources: readonly MemorySourceRef[]
): MemoryClaim[] {
  return texts.map((text, i) => ({
    id: buildClaimId(docPath, text, i),
    text,
    sources: [...sources],
  }));
}

export function setDocumentStatus(
  graph: ProvenanceGraph,
  relPath: string,
  status: MemoryStatus
): ProvenanceGraph {
  const docs = graph.documents.map((d) =>
    d.path === relPath ? { ...d, status } : d
  );
  return { ...graph, documents: docs };
}
