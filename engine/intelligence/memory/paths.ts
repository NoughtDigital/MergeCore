/**
 * Canonical paths under `.mergecore/` for shareable memory vs machine-local data.
 */

export const MERGECORE_DIR = '.mergecore';
export const MEMORY_DIR = '.mergecore/memory';
export const GENERATED_DIR = '.mergecore/generated';
export const GENERATED_MEMORY_DIR = '.mergecore/generated/memory';
export const CONTEXT_PACKS_DIR = '.mergecore/generated/context-packs';
export const EXPLANATIONS_DIR = '.mergecore/generated/explanations';
export const PROVENANCE_PATH = '.mergecore/generated/provenance.json';
export const CONFIG_PATH = '.mergecore/config.json';
/** Local-first usage metrics and retrieval feedback (machine-local). */
export const DIAGNOSTICS_DIR = '.mergecore/diagnostics';
export const USAGE_METRICS_PATH = '.mergecore/diagnostics/usage-metrics.json';
export const MISSING_CONTEXT_DIR = '.mergecore/diagnostics/missing-context';
export const LAST_INSPECTION_PATH = '.mergecore/diagnostics/last-inspection.json';
/** Machine-local index (must not be committed). */
export const RAG_DIR = '.mergecore/rag';

export const SHAREABLE_MEMORY_FILES = [
  'architecture.md',
  'conventions.md',
  'integrations.md',
  'glossary.md',
  'risks.md',
] as const;

export type ShareableMemoryBasename = (typeof SHAREABLE_MEMORY_FILES)[number];

export function isUnderGeneratedDir(relPath: string): boolean {
  const p = relPath.replace(/\\/g, '/');
  return p.startsWith('.mergecore/generated/') || p.includes('/.mergecore/generated/');
}

export function isUnderShareableMemoryDir(relPath: string): boolean {
  const p = relPath.replace(/\\/g, '/');
  return (
    p.startsWith('.mergecore/memory/') ||
    p.includes('/.mergecore/memory/')
  );
}

export function isUnderRagDir(relPath: string): boolean {
  const p = relPath.replace(/\\/g, '/');
  return p.startsWith('.mergecore/rag/') || p.includes('/.mergecore/rag/');
}
