import { sha256 } from '../rag/hash';
import type {
  ConflictDetectorKind,
  ExtractedConflictRule,
} from './types';

export interface InstructionMapResult {
  readonly description: string;
  readonly appliesTo: readonly string[];
  readonly suggestedDetector: ConflictDetectorKind;
  readonly suggestedFields: NonNullable<ExtractedConflictRule['suggestedFields']>;
  readonly ambiguous: boolean;
}

/**
 * Conservatively map imperative instruction text to a detector.
 * Returns undefined when the text is too vague to become a mandatory rule.
 */
export function mapInstructionTextToRule(
  text: string
): InstructionMapResult | undefined {
  const t = text.trim().replace(/\s+/g, ' ');
  if (t.length < 12) {
    return undefined;
  }

  const appliesTo = inferAppliesTo(t);
  const lower = t.toLowerCase();

  // Direct Prisma / ORM access
  if (
    /\b(prisma(?:client)?|typeorm|sequelize|mongoose|knex|eloquent|doctrine)\b/i.test(
      t
    ) &&
    /\b(must not|must never|never|do not|don't|shall not|cannot|may not)\b/i.test(t) &&
    /\b(access|use|import|call|query|instantiate)\b/i.test(t)
  ) {
    const db = matchDbToken(t);
    return {
      description: t,
      appliesTo: appliesTo.length > 0 ? appliesTo : ['**/controllers/**', '**/http/**'],
      suggestedDetector: 'direct_database_access',
      suggestedFields: {
        databaseAccessPatterns: db.patterns,
        forbiddenImports: db.imports,
      },
      ambiguous: false,
    };
  }

  // Forbidden imports (explicit package / module)
  const forbidImport = t.match(
    /\b(?:must not|never|do not|don't)\s+(?:import|require|use)\s+[`'"]?([@\w./-]+)[`'"]?/i
  );
  if (forbidImport?.[1]) {
    return {
      description: t,
      appliesTo: appliesTo.length > 0 ? appliesTo : ['**/*.{ts,tsx,js,jsx}'],
      suggestedDetector: 'forbidden_imports',
      suggestedFields: { forbiddenImports: [forbidImport[1]] },
      ambiguous: false,
    };
  }

  // Required abstraction
  const requireAbs = t.match(
    /\b(?:must|should|always)\s+(?:use|go through|call)\s+(?:the\s+)?[`'"]?([\w./-]+(?:Service|Repository|Gateway|Client|Facade))[`'"]?/i
  );
  if (requireAbs?.[1] && /\b(instead|not\s+direct|rather than)\b/i.test(lower)) {
    return {
      description: t,
      appliesTo: appliesTo.length > 0 ? appliesTo : ['**/controllers/**'],
      suggestedDetector: 'required_abstraction',
      suggestedFields: { requiredAbstractions: [requireAbs[1]] },
      ambiguous: false,
    };
  }

  // Prohibited directory dependencies
  const dirDep = t.match(
    /\b(?:must not|never|do not|don't)\s+(?:import|depend(?:\s+on)?)\s+(?:from\s+)?[`'"]?([\w./*-]+)[`'"]?/i
  );
  if (dirDep?.[1] && (dirDep[1].includes('/') || /domain|infra|internal/.test(dirDep[1]))) {
    return {
      description: t,
      appliesTo: appliesTo.length > 0 ? appliesTo : ['**/*.{ts,tsx}'],
      suggestedDetector: 'prohibited_directory_deps',
      suggestedFields: { prohibitedDirectories: [dirDep[1].replace(/\*$/, '')] },
      ambiguous: false,
    };
  }

  // Naming
  const naming = t.match(
    /\b(?:must|should)\s+(?:be\s+)?named\s+[`'"]?([*\w.-]+\.\w+)[`'"]?/i
  );
  if (naming?.[1]) {
    return {
      description: t,
      appliesTo: appliesTo.length > 0 ? appliesTo : ['**/*'],
      suggestedDetector: 'naming_rules',
      suggestedFields: {
        namingPattern: globishToRegexSource(naming[1]),
        namingMustMatch: true,
      },
      ambiguous: false,
    };
  }

  // Tests location
  if (
    /\b(tests?|specs?)\b/i.test(t) &&
    /\b(must|should|belong|live|place|colocate)\b/i.test(t) &&
    /\b(must not|never|do not|don't|must|should)\b/i.test(t)
  ) {
    const testGlob =
      t.match(/[`'"]([^`'"]+\.(?:test|spec)\.\w+)[`'"]/)?.[1] ??
      (/\bnext to\b|\bco-?located\b/i.test(t) ? '**/*.{test,spec}.{ts,tsx,js}' : undefined);
    if (testGlob) {
      return {
        description: t,
        appliesTo: appliesTo.length > 0 ? appliesTo : ['**/src/**/*.{ts,tsx}'],
        suggestedDetector: 'required_test_location',
        suggestedFields: { requiredTestGlobs: [testGlob] },
        ambiguous: false,
      };
    }
  }

  // Network providers
  if (
    /\b(stripe|twilio|sendgrid|aws-sdk|@aws-sdk|openai|anthropic|fetch\s+to\s+external)\b/i.test(
      t
    ) &&
    /\b(must not|never|do not|don't)\b/i.test(t) &&
    /\b(call|access|import|use|invoke)\b/i.test(t)
  ) {
    const providers = extractNetworkProviders(t);
    if (providers.length > 0) {
      return {
        description: t,
        appliesTo: appliesTo.length > 0 ? appliesTo : ['**/controllers/**', '**/ui/**'],
        suggestedDetector: 'network_provider_access',
        suggestedFields: { networkProviderPatterns: providers },
        ambiguous: false,
      };
    }
  }

  // Environment variables
  const env = t.match(
    /\b(?:must not|never|do not|don't)\s+(?:read|access|use)\s+(?:process\.env\.|getenv\(|ENV\[)?[`'"]?([A-Z][A-Z0-9_]*)[`'"]?/
  );
  if (env?.[1]) {
    return {
      description: t,
      appliesTo: appliesTo.length > 0 ? appliesTo : ['**/*.{ts,tsx,js}'],
      suggestedDetector: 'environment_variable_access',
      suggestedFields: { environmentVariablePatterns: [env[1]] },
      ambiguous: false,
    };
  }

  // Imperative but not mappable — mark ambiguous so it never auto-scans
  if (/\b(must|should|never|always|do not|don't)\b/i.test(t)) {
    return {
      description: t,
      appliesTo: appliesTo,
      suggestedDetector: 'forbidden_imports',
      suggestedFields: {},
      ambiguous: true,
    };
  }

  return undefined;
}

export function makeExtractedRuleId(sourcePath: string, startLine: number, text: string): string {
  return `extracted:${sha256(`${sourcePath}:${startLine}:${text}`).slice(0, 16)}`;
}

function inferAppliesTo(text: string): string[] {
  const out: string[] = [];
  if (/\bcontrollers?\b/i.test(text)) {
    out.push('**/controllers/**', '**/http/controllers/**', 'src/controllers/**/*.{ts,tsx,js}');
  }
  if (/\broutes?\b/i.test(text)) {
    out.push('**/routes/**', '**/http/routes/**');
  }
  if (/\bservices?\b/i.test(text) && !/\bcontrollers?\b/i.test(text)) {
    out.push('**/services/**');
  }
  if (/\brepositories?\b/i.test(text)) {
    out.push('**/repositories/**');
  }
  if (/\bcomponents?\b/i.test(text)) {
    out.push('**/components/**/*.{ts,tsx,jsx}');
  }
  if (/\btests?\b/i.test(text) && /\bmust\s+be\s+named\b/i.test(text)) {
    out.push('**/*.{test,spec}.{ts,tsx,js}');
  }
  return [...new Set(out)];
}

function matchDbToken(text: string): { patterns: string[]; imports: string[] } {
  const patterns: string[] = [];
  const imports: string[] = [];
  if (/prisma/i.test(text)) {
    patterns.push('PrismaClient', 'prisma.');
    imports.push('@prisma/client');
  }
  if (/typeorm/i.test(text)) {
    patterns.push('getRepository(', 'DataSource');
    imports.push('typeorm');
  }
  if (/sequelize/i.test(text)) {
    patterns.push('Sequelize', 'sequelize.');
    imports.push('sequelize');
  }
  if (/mongoose/i.test(text)) {
    patterns.push('mongoose.');
    imports.push('mongoose');
  }
  if (/knex/i.test(text)) {
    patterns.push('knex(');
    imports.push('knex');
  }
  if (/eloquent/i.test(text)) {
    patterns.push('::query(', 'Eloquent\\');
  }
  if (patterns.length === 0) {
    patterns.push('PrismaClient');
    imports.push('@prisma/client');
  }
  return { patterns, imports };
}

function extractNetworkProviders(text: string): string[] {
  const out: string[] = [];
  for (const p of [
    'stripe',
    'twilio',
    'sendgrid',
    '@aws-sdk',
    'aws-sdk',
    'openai',
    'anthropic',
  ]) {
    if (new RegExp(p.replace('@', '\\@'), 'i').test(text)) {
      out.push(p);
    }
  }
  return out;
}

function globishToRegexSource(name: string): string {
  return `^${name.replace(/\./g, '\\.').replace(/\*/g, '.*')}$`;
}
