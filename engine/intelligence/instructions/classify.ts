import type {
  AuthoredBy,
  ClassificationConfidence,
  ContextDocumentType,
  InstructionBinding,
} from './types';
import { normalisePath } from './frontmatter';

export interface ClassificationResult {
  readonly documentType: ContextDocumentType;
  readonly authored: AuthoredBy;
  readonly classificationConfidence: ClassificationConfidence;
  readonly binding: InstructionBinding;
  readonly scope: string;
}

/**
 * Classify a context file by path / basename. Does not treat every Markdown
 * file as binding instruction.
 */
export function classifyContextPath(
  relPath: string,
  options: { userConfigured?: boolean; underGeneratedMemory?: boolean } = {}
): ClassificationResult {
  const p = normalisePath(relPath);
  const base = basename(p);
  const lower = base.toLowerCase();
  const dir = dirname(p);

  if (
    options.underGeneratedMemory ||
    p.includes('.mergecore/rag/') ||
    p.includes('.mergecore/generated/')
  ) {
    return {
      documentType: 'generated_memory',
      authored: 'generated',
      classificationConfidence: 'high',
      binding: 'generated',
      scope: scopeFromPath(p, 'memory'),
    };
  }

  // Shareable human engineering memory under .mergecore/memory/
  if (p.includes('.mergecore/memory/')) {
    if (lower === 'architecture.md') {
      return {
        documentType: 'architecture',
        authored: 'human',
        classificationConfidence: 'high',
        binding: 'contextual',
        scope: '',
      };
    }
    if (lower === 'conventions.md') {
      return {
        documentType: 'convention',
        authored: 'human',
        classificationConfidence: 'high',
        binding: 'contextual',
        scope: '',
      };
    }
    if (lower === 'integrations.md') {
      return {
        documentType: 'integration',
        authored: 'human',
        classificationConfidence: 'high',
        binding: 'contextual',
        scope: '',
      };
    }
    if (lower === 'glossary.md') {
      return {
        documentType: 'glossary',
        authored: 'human',
        classificationConfidence: 'high',
        binding: 'contextual',
        scope: '',
      };
    }
    if (lower === 'risks.md') {
      return {
        documentType: 'risk',
        authored: 'human',
        classificationConfidence: 'high',
        binding: 'contextual',
        scope: '',
      };
    }
    return {
      documentType: 'general_documentation',
      authored: 'human',
      classificationConfidence: 'medium',
      binding: 'contextual',
      scope: '',
    };
  }

  if (isAgentsOrClaude(lower)) {
    return {
      documentType: 'instruction',
      authored: 'human',
      classificationConfidence: 'high',
      binding: 'binding',
      scope: dir,
    };
  }

  if (isCursorRulesPath(p) || lower === '.cursorrules') {
    return {
      documentType: 'convention',
      authored: 'human',
      classificationConfidence: 'high',
      binding: 'binding',
      scope: '',
    };
  }

  if (isAdrPath(p, lower)) {
    return {
      documentType: 'decision',
      authored: 'human',
      classificationConfidence: 'high',
      binding: 'contextual',
      scope: '',
    };
  }

  if (/^readme(\.[a-z0-9]+)?\.md$/i.test(lower) || lower.startsWith('readme.')) {
    return {
      documentType: 'general_documentation',
      authored: 'human',
      classificationConfidence: 'high',
      binding: 'contextual',
      scope: dir,
    };
  }

  if (lower === 'contributing.md') {
    return {
      documentType: 'convention',
      authored: 'human',
      classificationConfidence: 'high',
      binding: 'contextual',
      scope: '',
    };
  }

  if (/architecture/i.test(p) && lower.endsWith('.md')) {
    return {
      documentType: 'architecture',
      authored: 'human',
      classificationConfidence: 'medium',
      binding: 'contextual',
      scope: '',
    };
  }

  if (/glossary/i.test(lower)) {
    return {
      documentType: 'glossary',
      authored: 'human',
      classificationConfidence: 'high',
      binding: 'contextual',
      scope: '',
    };
  }

  if (/risk|security|threat/i.test(lower)) {
    return {
      documentType: 'risk',
      authored: 'human',
      classificationConfidence: 'medium',
      binding: 'contextual',
      scope: '',
    };
  }

  if (/integrat/i.test(lower)) {
    return {
      documentType: 'integration',
      authored: 'human',
      classificationConfidence: 'medium',
      binding: 'contextual',
      scope: '',
    };
  }

  if (options.userConfigured) {
    return {
      documentType: 'instruction',
      authored: 'human',
      classificationConfidence: 'medium',
      binding: 'binding',
      // User-configured paths apply repository-wide unless they are nested AGENTS/CLAUDE.
      scope: isAgentsOrClaude(lower) ? dir : '',
    };
  }

  if (p.startsWith('docs/') || p.includes('/docs/')) {
    return {
      documentType: 'general_documentation',
      authored: 'human',
      classificationConfidence: 'medium',
      binding: 'contextual',
      scope: '',
    };
  }

  return {
    documentType: 'general_documentation',
    authored: 'human',
    classificationConfidence: 'low',
    binding: 'contextual',
    scope: '',
  };
}

export function isAgentsOrClaude(basenameLower: string): boolean {
  return (
    basenameLower === 'agents.md' ||
    basenameLower === 'claude.md' ||
    basenameLower === 'agent.md'
  );
}

export function isCursorRulesPath(relPath: string): boolean {
  const p = normalisePath(relPath);
  return (
    p.startsWith('.cursor/rules/') ||
    p.includes('/.cursor/rules/') ||
    /\.mdc$/i.test(p)
  );
}

export function isAdrPath(relPath: string, basenameLower?: string): boolean {
  const p = normalisePath(relPath);
  const base = (basenameLower ?? basename(p)).toLowerCase();
  if (
    p.includes('/docs/adr/') ||
    p.includes('/docs/adrs/') ||
    p.startsWith('docs/adr/') ||
    p.startsWith('docs/adrs/') ||
    p.startsWith('adr/') ||
    p.includes('/adr/') ||
    p.startsWith('architecture/decisions/') ||
    p.includes('/architecture/decisions/')
  ) {
    return true;
  }
  if (/^adr[-_]/i.test(base)) {
    return true;
  }
  // NNNN-*.md inside an ADR-like directory
  if (/^\d{3,5}-.+\.md$/i.test(base)) {
    if (
      /\/(adr|adrs|decisions)(\/|$)/i.test(p) ||
      p.startsWith('adr/') ||
      p.startsWith('docs/adr')
    ) {
      return true;
    }
  }
  return false;
}

function scopeFromPath(relPath: string, kind: string): string {
  if (kind === 'memory') {
    return '';
  }
  return dirname(relPath);
}

function basename(p: string): string {
  const n = normalisePath(p);
  const i = n.lastIndexOf('/');
  return i >= 0 ? n.slice(i + 1) : n;
}

function dirname(p: string): string {
  const n = normalisePath(p);
  const i = n.lastIndexOf('/');
  return i >= 0 ? n.slice(0, i) : '';
}
