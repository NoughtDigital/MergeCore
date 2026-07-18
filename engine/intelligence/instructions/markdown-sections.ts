import { chunkId, sha256 } from '../rag/hash';
import type { MarkdownSection } from './types';
import { parseFrontmatter } from './frontmatter';

/**
 * Index Markdown by headings and logical sections, preserving heading ancestry.
 * Falls back to a single document section when no headings exist.
 */
export function chunkMarkdownByHeadings(
  filePath: string,
  content: string
): readonly MarkdownSection[] {
  const { body, bodyStartLine } = parseFrontmatter(content);
  const lines = body.split(/\r?\n/);
  const sections: MarkdownSection[] = [];
  const stack: Array<{ level: number; title: string }> = [];

  let sectionStart = 0;
  let sectionTitle = pathBase(filePath);
  let sectionLevel = 0;

  const flush = (endExclusive: number): void => {
    const text = lines.slice(sectionStart, endExclusive).join('\n').trim();
    if (!text) {
      return;
    }
    const ancestry = stack.map((s) => s.title);
    if (sectionTitle && (ancestry.length === 0 || ancestry[ancestry.length - 1] !== sectionTitle)) {
      // include current title as leaf when stack was reset for this section
    }
    const headingAncestry =
      stack.length > 0 ? stack.map((s) => s.title) : sectionTitle ? [sectionTitle] : [];
    const startLine = bodyStartLine + sectionStart;
    const endLine = bodyStartLine + endExclusive - 1;
    sections.push({
      id: chunkId(filePath, startLine, Math.max(startLine, endLine), headingAncestry.join('>')),
      path: filePath.replace(/\\/g, '/'),
      title: sectionTitle || pathBase(filePath),
      headingAncestry,
      level: sectionLevel,
      text,
      startLine,
      endLine: Math.max(startLine, endLine),
    });
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? '';
    const heading = line.match(/^(#{1,6})\s+(.+?)\s*$/);
    if (!heading) {
      continue;
    }
    if (i > sectionStart) {
      flush(i);
    }
    const level = heading[1]!.length;
    const title = heading[2]!.trim();
    while (stack.length > 0 && stack[stack.length - 1]!.level >= level) {
      stack.pop();
    }
    stack.push({ level, title });
    sectionStart = i;
    sectionTitle = title;
    sectionLevel = level;
  }

  flush(lines.length);

  if (sections.length === 0) {
    const text = body.trim();
    const endLine = Math.max(1, bodyStartLine + Math.max(0, lines.length - 1));
    sections.push({
      id: chunkId(filePath, bodyStartLine, endLine, pathBase(filePath)),
      path: filePath.replace(/\\/g, '/'),
      title: pathBase(filePath),
      headingAncestry: [pathBase(filePath)],
      level: 0,
      text: text || content.slice(0, 200),
      startLine: bodyStartLine,
      endLine,
    });
  }

  return sections;
}

/**
 * Extract instruction-like items (imperative bullets / numbered rules) from a
 * section. Prose-only paragraphs are not treated as instructions.
 */
export function extractInstructionTexts(
  section: MarkdownSection
): readonly { text: string; startLine: number; endLine: number }[] {
  const lines = section.text.split(/\r?\n/);
  const out: { text: string; startLine: number; endLine: number }[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? '';
    const bullet = line.match(/^\s*(?:[-*]|\d+\.)\s+(.+)$/);
    if (!bullet) {
      continue;
    }
    const text = bullet[1]!.trim();
    if (!looksLikeInstruction(text)) {
      continue;
    }
    const absLine = section.startLine + i;
    out.push({ text, startLine: absLine, endLine: absLine });
  }
  // If a dedicated instruction doc has no bullets, keep the whole section as one unit
  // only when the heading suggests rules / instructions.
  if (out.length === 0 && /agent|instruction|rule|must|should|do not|don't/i.test(section.title)) {
    const trimmed = section.text.replace(/^#{1,6}\s+.+\n?/, '').trim();
    if (trimmed.length >= 12 && looksLikeInstruction(trimmed.slice(0, 200))) {
      out.push({
        text: trimmed.slice(0, 2000),
        startLine: section.startLine,
        endLine: section.endLine,
      });
    }
  }
  return out;
}

export function looksLikeInstruction(text: string): boolean {
  const t = text.trim();
  if (t.length < 8) {
    return false;
  }
  // Skip pure links / images / table separators
  if (/^!\[/.test(t) || /^\|/.test(t) || /^https?:\/\//i.test(t)) {
    return false;
  }
  return (
    /^(always|never|must|should|do not|don't|prefer|use|avoid|require|ensure|keep|write|run|add|remove|treat|prefer)\b/i.test(
      t
    ) ||
    /\b(must|should|shall|do not|don't|never|always)\b/i.test(t) ||
    /^[-*]\s+/i.test(t) === false // already stripped; imperative verbs above
  );
}

export function contentHash(content: string): string {
  return sha256(content);
}

function pathBase(p: string): string {
  return p.replace(/\\/g, '/').split('/').pop() ?? p;
}
