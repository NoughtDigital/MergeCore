import { sha256 } from '../../rag/hash';
import { languageForTsJs, normaliseRel } from './paths';

/**
 * Stable symbol ID: language:relPath:name:kind:startLine:startColumn
 * Span-based so hover can use the ID from the latest index.
 */
export function buildSymbolId(input: {
  readonly filePath: string;
  readonly name: string;
  readonly kind: string;
  readonly startLine: number;
  readonly startColumn: number;
  readonly overloadIndex?: number;
}): string {
  const lang = languageForTsJs(input.filePath);
  const rel = normaliseRel(input.filePath);
  const base = `${lang}:${rel}:${input.name}:${input.kind}:${input.startLine}:${input.startColumn}`;
  if (input.overloadIndex !== undefined && input.overloadIndex > 0) {
    return `${base}:o${input.overloadIndex}`;
  }
  return base;
}

export function edgeId(parts: ReadonlyArray<string | number | undefined>): string {
  const raw = parts.map((p) => String(p ?? '')).join('|');
  return `edge:${sha256(raw).slice(0, 32)}`;
}
