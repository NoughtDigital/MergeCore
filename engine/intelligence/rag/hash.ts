import { createHash } from 'crypto';

export function sha256(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

export function chunkId(path: string, startLine: number, endLine: number, symbol?: string): string {
  const base = `${path}:${startLine}:${endLine}:${symbol ?? ''}`;
  return sha256(base).slice(0, 24);
}
