import * as fs from 'fs/promises';
import * as path from 'path';
import { discoverContextDocuments } from './discover';
import { normalisePath, pathMatchesGlob } from './frontmatter';
import {
  chunkMarkdownByHeadings,
  extractInstructionTexts,
} from './markdown-sections';
import type {
  ApplicableInstruction,
  ContextDocument,
  InstructionConflict,
  InstructionPrecedenceExplanation,
  InstructionResolverOptions,
  MarkdownSection,
} from './types';

/** Precedence bands (higher = stronger). */
export const PRECEDENCE = {
  USER_CONFIGURED: 1000,
  CLOSEST_SCOPED_INSTRUCTION: 900,
  PARENT_SCOPED_INSTRUCTION: 800,
  ROOT_SCOPED_INSTRUCTION: 700,
  CURSOR_GLOB_RULE: 600,
  CONTEXTUAL_DOC: 400,
  /** Approved generated memory — below human contextual docs. */
  APPROVED_MEMORY: 250,
  REVIEWED_MEMORY: 150,
  GENERATED_MEMORY: 100,
} as const;

export interface InstructionResolver {
  getApplicableInstructions(targetFile: string): Promise<readonly ApplicableInstruction[]>;
  getApplicableDocuments(targetFile: string): Promise<readonly ContextDocument[]>;
  explainInstructionPrecedence(targetFile: string): Promise<InstructionPrecedenceExplanation>;
  findInstructionConflicts(targetFile: string): Promise<readonly InstructionConflict[]>;
}

/**
 * Create a resolver that discovers (or uses provided) context documents and
 * returns scoped, evidence-backed instructions for a target source file.
 */
export async function createInstructionResolver(
  options: InstructionResolverOptions
): Promise<InstructionResolver> {
  const roots = [
    path.resolve(options.workspaceRoot),
    ...(options.workspaceRoots ?? []).map((r) => path.resolve(r)),
  ];
  const uniqueRoots = [...new Set(roots)];

  const documents: ContextDocument[] = options.documents
    ? [...options.documents]
    : [];

  if (!options.documents) {
    for (const root of uniqueRoots) {
      const discovered = await discoverContextDocuments({
        workspaceRoot: root,
        configuredPaths: options.configuredPaths,
        contextDirectory: options.contextDirectory,
      });
      // Prefix multi-root paths when multiple roots share relative paths
      for (const doc of discovered) {
        documents.push(
          uniqueRoots.length > 1
            ? {
                ...doc,
                id: `ctx:${path.basename(root)}:${doc.path}`,
                path: doc.path,
              }
            : doc
        );
      }
    }
  }

  const sectionsByPath =
    options.sectionsByPath ??
    (await loadSections(uniqueRoots[0]!, documents));

  return new InstructionResolverImpl(uniqueRoots, documents, sectionsByPath);
}

class InstructionResolverImpl implements InstructionResolver {
  constructor(
    _roots: readonly string[],
    private readonly documents: readonly ContextDocument[],
    private readonly sectionsByPath: ReadonlyMap<string, readonly MarkdownSection[]>
  ) {
    void _roots;
  }

  async getApplicableDocuments(targetFile: string): Promise<readonly ContextDocument[]> {
    const target = normalisePath(targetFile);
    const out: ContextDocument[] = [];
    for (const doc of this.documents) {
      if (documentApplies(doc, target)) {
        out.push(doc);
      }
    }
    return out.sort((a, b) => compareDocs(a, b, target));
  }

  async getApplicableInstructions(
    targetFile: string
  ): Promise<readonly ApplicableInstruction[]> {
    const target = normalisePath(targetFile);
    const docs = await this.getApplicableDocuments(target);
    const instructions: ApplicableInstruction[] = [];

    for (const doc of docs) {
      const precedence = precedenceFor(doc, target);
      const sections = this.sectionsByPath.get(doc.path) ?? [];
      if (doc.binding === 'binding' || doc.userConfigured) {
        for (const section of sections) {
          const texts = extractInstructionTexts(section);
          if (texts.length === 0 && doc.documentType === 'instruction') {
            // Entire instruction file section as one unit when no bullets
            instructions.push(
              toInstruction(doc, section, section.text.replace(/^#{1,6}\s+.+\n?/, '').trim() || section.title, precedence, section.startLine, section.endLine)
            );
            continue;
          }
          for (const item of texts) {
            instructions.push(
              toInstruction(doc, section, item.text, precedence, item.startLine, item.endLine)
            );
          }
        }
      } else {
        // Contextual: one entry per section (not treated as binding override)
        for (const section of sections) {
          const text = section.text.replace(/^#{1,6}\s+.+\n?/, '').trim();
          if (text.length < 12) {
            continue;
          }
          instructions.push(
            toInstruction(
              doc,
              section,
              text.slice(0, 1500),
              precedence,
              section.startLine,
              section.endLine
            )
          );
        }
      }
    }

    return instructions.sort((a, b) => b.precedence - a.precedence || a.sourceFile.localeCompare(b.sourceFile));
  }

  async explainInstructionPrecedence(
    targetFile: string
  ): Promise<InstructionPrecedenceExplanation> {
    const target = normalisePath(targetFile);
    const ordered = await this.getApplicableInstructions(target);
    const conflicts = await this.findInstructionConflicts(target);
    const rationale: string[] = [];

    const closest = ordered.find((i) => i.binding === 'binding' && i.documentType === 'instruction');
    if (closest) {
      rationale.push(
        `Nearest binding instruction is ${closest.sourceFile} (scope "${closest.scope || '/'}", precedence ${closest.precedence}).`
      );
    }
    for (const instr of ordered.filter((i) => i.binding === 'binding').slice(0, 8)) {
      rationale.push(
        `${instr.sourceFile}:${instr.startLine}-${instr.endLine} applies because target "${target}" is under scope "${instr.scope || '/'}"` +
          (instr.userConfigured ? ' (user-configured)' : '') +
          (instr.frontmatter?.globs?.length
            ? ` and matches globs ${instr.frontmatter.globs.join(', ')}`
            : '') +
          `.`
      );
    }
    for (const c of conflicts) {
      rationale.push(`Conflict: ${c.reason}`);
    }
    if (ordered.some((i) => i.authored === 'generated')) {
      rationale.push('Generated MergeCore memory is present but never overrides human-authored instructions.');
    }
    if (ordered.some((i) => i.binding === 'contextual')) {
      rationale.push('README / ADR / general documentation provide context but are not binding overrides.');
    }

    return { targetFile: target, ordered, rationale, conflicts };
  }

  async findInstructionConflicts(
    targetFile: string
  ): Promise<readonly InstructionConflict[]> {
    const target = normalisePath(targetFile);
    const binding = (await this.getApplicableInstructions(target)).filter(
      (i) => i.binding === 'binding' && i.authored === 'human'
    );

    // Group by equal precedence
    const byPrec = new Map<number, ApplicableInstruction[]>();
    for (const instr of binding) {
      const list = byPrec.get(instr.precedence) ?? [];
      list.push(instr);
      byPrec.set(instr.precedence, list);
    }

    const conflicts: InstructionConflict[] = [];
    for (const [prec, group] of byPrec) {
      if (group.length < 2) {
        continue;
      }
      // Different source files at same precedence → conflict candidates
      const byFile = new Map<string, ApplicableInstruction[]>();
      for (const g of group) {
        const list = byFile.get(g.sourceFile) ?? [];
        list.push(g);
        byFile.set(g.sourceFile, list);
      }
      if (byFile.size < 2) {
        continue;
      }
      const files = [...byFile.keys()];
      // Heuristic: opposing modalities (must vs must not / never / always)
      const texts = group.map((g) => g.text.toLowerCase());
      const hasMust = texts.some((t) => /\b(must|always|shall)\b/.test(t));
      const hasMustNot = texts.some((t) => /\b(must not|never|do not|don't)\b/.test(t));
      if (hasMust && hasMustNot) {
        conflicts.push({
          topic: `equal-precedence-${prec}`,
          reason: `Equal-precedence binding instructions from ${files.join(' and ')} appear to contradict (must vs must-not).`,
          instructions: group,
        });
      } else if (files.length >= 2) {
        conflicts.push({
          topic: `equal-precedence-${prec}`,
          reason: `Multiple binding instruction sources at precedence ${prec} (${files.join(', ')}) without a closer override — review manually.`,
          instructions: group,
        });
      }
    }

    // Generated vs human: if generated claims binding (should not), flag
    const generated = (await this.getApplicableInstructions(target)).filter(
      (i) => i.authored === 'generated' && i.binding !== 'generated'
    );
    if (generated.length > 0) {
      conflicts.push({
        topic: 'generated-vs-human',
        reason: 'Generated memory must not override human-authored instructions.',
        instructions: generated,
      });
    }

    return conflicts;
  }
}

function documentApplies(doc: ContextDocument, target: string): boolean {
  if (doc.authored === 'generated' || doc.documentType === 'generated_memory') {
    const status = String(doc.frontmatter?.fields?.status ?? 'generated');
    // Rejected and stale generated memory must not influence answers
    if (status === 'rejected' || status === 'stale') {
      return false;
    }
    return true; // included but low precedence / non-overriding
  }

  if (doc.frontmatter?.globs && doc.frontmatter.globs.length > 0) {
    if (doc.frontmatter.alwaysApply) {
      return true;
    }
    return doc.frontmatter.globs.some((g) => pathMatchesGlob(target, g));
  }

  if (doc.userConfigured) {
    return true;
  }

  if (doc.documentType === 'instruction') {
    return isUnderScope(target, doc.scope);
  }

  // Cursor rules without globs apply repo-wide
  if (doc.path.includes('.cursor/rules') || doc.path.endsWith('.mdc')) {
    return true;
  }

  // Contextual docs always available as non-binding context
  if (doc.binding === 'contextual') {
    return true;
  }

  return isUnderScope(target, doc.scope);
}

function isUnderScope(target: string, scope: string): boolean {
  const t = normalisePath(target);
  const s = normalisePath(scope);
  if (!s) {
    return true;
  }
  return t === s || t.startsWith(`${s}/`);
}

function precedenceFor(doc: ContextDocument, target: string): number {
  if (doc.authored === 'generated' || doc.documentType === 'generated_memory') {
    const status = String(doc.frontmatter?.fields?.status ?? 'generated');
    if (status === 'approved') return PRECEDENCE.APPROVED_MEMORY;
    if (status === 'reviewed') return PRECEDENCE.REVIEWED_MEMORY;
    return PRECEDENCE.GENERATED_MEMORY;
  }
  if (doc.userConfigured) {
    return PRECEDENCE.USER_CONFIGURED;
  }
  if (doc.binding === 'contextual') {
    return PRECEDENCE.CONTEXTUAL_DOC;
  }
  if (doc.frontmatter?.globs?.length || doc.path.includes('.cursor/rules')) {
    return PRECEDENCE.CURSOR_GLOB_RULE;
  }
  if (doc.documentType === 'instruction') {
    const scope = normalisePath(doc.scope);
    const depth = scope ? scope.split('/').length : 0;
    if (!scope) {
      return PRECEDENCE.ROOT_SCOPED_INSTRUCTION;
    }
    const targetDir = dirname(target);
    if (scope === targetDir) {
      return PRECEDENCE.CLOSEST_SCOPED_INSTRUCTION + depth;
    }
    if (isUnderScope(target, scope)) {
      return PRECEDENCE.PARENT_SCOPED_INSTRUCTION + depth;
    }
    return PRECEDENCE.ROOT_SCOPED_INSTRUCTION;
  }
  return PRECEDENCE.CONTEXTUAL_DOC;
}

function compareDocs(a: ContextDocument, b: ContextDocument, target: string): number {
  return precedenceFor(b, target) - precedenceFor(a, target) || a.path.localeCompare(b.path);
}

function toInstruction(
  doc: ContextDocument,
  section: MarkdownSection,
  text: string,
  precedence: number,
  startLine: number,
  endLine: number
): ApplicableInstruction {
  return {
    id: `instr:${doc.path}:${startLine}:${hashShort(text)}`,
    text,
    sourceFile: doc.path,
    startLine,
    endLine,
    scope: doc.scope,
    documentType: doc.documentType,
    precedence,
    authored: doc.authored,
    classificationConfidence: doc.classificationConfidence,
    binding: doc.binding,
    headingAncestry: section.headingAncestry,
    userConfigured: doc.userConfigured,
    frontmatter: doc.frontmatter,
    excerpt: text.slice(0, 200),
  };
}

function dirname(p: string): string {
  const n = normalisePath(p);
  const i = n.lastIndexOf('/');
  return i >= 0 ? n.slice(0, i) : '';
}

function hashShort(text: string): string {
  let h = 0;
  for (let i = 0; i < text.length; i++) {
    h = (h * 31 + text.charCodeAt(i)) | 0;
  }
  return Math.abs(h).toString(16).slice(0, 8);
}

async function loadSections(
  workspaceRoot: string,
  documents: readonly ContextDocument[]
): Promise<Map<string, readonly MarkdownSection[]>> {
  const map = new Map<string, readonly MarkdownSection[]>();
  for (const doc of documents) {
    try {
      const content = await fs.readFile(path.join(workspaceRoot, doc.path), 'utf8');
      map.set(doc.path, chunkMarkdownByHeadings(doc.path, content));
    } catch {
      // skip unreadable
    }
  }
  return map;
}
