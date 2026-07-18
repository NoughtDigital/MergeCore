import ignore from 'ignore';
import type { Ignore } from 'ignore';
import type {
  PrivacyClassification,
  PrivacyDecision,
  PrivacyRule,
  PrivacyRuleSource,
} from '../contracts/types';
import { NestedIgnoreResolver } from '../ignore/resolve-ignore';
import {
  extensionForPrivacyPath,
  languageForPrivacyPath,
} from './path-language';
import {
  compareRulePriority,
  decisionFromClassification,
  wouldWeaken,
  PRIVACY_STRENGTH,
} from './types';
import {
  loadAllPrivacyRules,
  loadPrivacyOverrides,
  type LoadAllPrivacyRulesOptions,
} from './load-rules';

function ruleAppliesToPath(rule: PrivacyRule, relPath: string): boolean {
  const language = languageForPrivacyPath(relPath);
  const ext = extensionForPrivacyPath(relPath);
  if (rule.languages && rule.languages.length > 0) {
    if (!rule.languages.includes(language)) {
      return false;
    }
  }
  if (rule.extensions && rule.extensions.length > 0) {
    if (!rule.extensions.map((e) => e.toLowerCase()).includes(ext)) {
      return false;
    }
  }
  return true;
}

function matchPattern(pattern: string, relPath: string): boolean {
  const ig: Ignore = ignore().add(pattern);
  try {
    return ig.ignores(relPath.replace(/\\/g, '/'));
  } catch {
    return false;
  }
}

export interface MatchedPrivacyRule {
  readonly rule: PrivacyRule;
  readonly classification: PrivacyClassification;
}

export interface EvaluatePrivacyOptions {
  readonly workspaceRoot: string;
  readonly relPath: string;
  readonly rules?: readonly PrivacyRule[];
  readonly overrides?: Readonly<Record<string, PrivacyClassification>>;
  readonly ignoreResolver?: NestedIgnoreResolver;
  readonly globalConfigPath?: string;
  readonly vscodeExtraExclusions?: readonly string[];
  readonly skipGlobalFile?: boolean;
  /**
   * When true, allow a weaker rule to win without an overrides entry (tests only).
   */
  readonly allowWeakenWithoutOverride?: boolean;
}

/**
 * Resolve the effective privacy classification for a workspace-relative path.
 */
export async function evaluatePathPrivacy(
  options: EvaluatePrivacyOptions
): Promise<PrivacyDecision> {
  const rel = options.relPath.replace(/\\/g, '/').replace(/^\.\//, '');
  const fileOverrides = loadPrivacyOverrides(options.workspaceRoot);
  const loaded =
    options.rules !== undefined
      ? {
          rules: options.rules,
          overrides: fileOverrides,
        }
      : loadAllPrivacyRules({
          workspaceRoot: options.workspaceRoot,
          globalConfigPath: options.globalConfigPath,
          vscodeExtraExclusions: options.vscodeExtraExclusions,
          skipGlobalFile: options.skipGlobalFile,
        });

  const overrides = options.overrides ?? loaded.overrides.overrides;

  if (overrides[rel]) {
    return decisionFromClassification(rel, overrides[rel]!, {
      matchedPattern: 'privacy-overrides.json',
      ruleSource: 'override',
      rulePath: `${options.workspaceRoot.replace(/\\/g, '/')}/.mergecore/privacy-overrides.json`,
      detail: 'User-confirmed privacy override',
    });
  }

  const candidates: MatchedPrivacyRule[] = [];

  for (const rule of loaded.rules) {
    if (!ruleAppliesToPath(rule, rel)) {
      continue;
    }
    if (!matchPattern(rule.pattern, rel)) {
      continue;
    }
    candidates.push({ rule, classification: rule.classification });
  }

  const resolver =
    options.ignoreResolver ?? new NestedIgnoreResolver(options.workspaceRoot);
  const ignoreDecision = await resolver.decide(rel, false);
  if (ignoreDecision.ignored) {
    const source: PrivacyRuleSource =
      ignoreDecision.reason === 'mergecoreignore' ? 'mergecoreignore' : 'gitignore';
    candidates.push({
      rule: {
        pattern: ignoreDecision.detail ?? source,
        classification: 'never_index',
        source,
        rulePath: ignoreDecision.detail,
      },
      classification: 'never_index',
    });
  }

  if (candidates.length === 0) {
    return decisionFromClassification(rel, 'normal', {
      ruleSource: 'default',
      detail: 'No privacy rule matched',
    });
  }

  let chosen = candidates[0]!;
  for (const cur of candidates.slice(1)) {
    const cmp = compareRulePriority(
      { classification: cur.classification, source: cur.rule.source },
      { classification: chosen.classification, source: chosen.rule.source }
    );
    if (cmp < 0) {
      chosen = cur;
    }
  }

  if (chosen.rule.include && chosen.classification === 'normal') {
    const stronger = candidates.find(
      (c) =>
        !c.rule.include &&
        PRIVACY_STRENGTH[c.classification] > PRIVACY_STRENGTH.normal
    );
    if (stronger) {
      chosen = stronger;
    }
  }

  if (!options.allowWeakenWithoutOverride) {
    const strongest = candidates.reduce((best, cur) =>
      PRIVACY_STRENGTH[cur.classification] > PRIVACY_STRENGTH[best.classification]
        ? cur
        : best
    );
    if (wouldWeaken(strongest.classification, chosen.classification)) {
      chosen = strongest;
    }
  }

  const languageScoped = Boolean(
    chosen.rule.languages?.length || chosen.rule.extensions?.length
  );

  return decisionFromClassification(rel, chosen.classification, {
    matchedPattern: chosen.rule.pattern,
    ruleSource: chosen.rule.source,
    rulePath: chosen.rule.rulePath,
    detail: `${chosen.rule.source}:${chosen.rule.pattern}`,
    languageScoped,
  });
}

export interface CreatePrivacyEngineOptions extends LoadAllPrivacyRulesOptions {
  readonly ignoreResolver?: NestedIgnoreResolver;
}

export interface PrivacyRuleEngine {
  evaluate(relPath: string): Promise<PrivacyDecision>;
  readonly rules: readonly PrivacyRule[];
  readonly overrides: Readonly<Record<string, PrivacyClassification>>;
}

export function createPrivacyRuleEngine(
  options: CreatePrivacyEngineOptions
): PrivacyRuleEngine {
  const loaded = loadAllPrivacyRules(options);
  const ignoreResolver =
    options.ignoreResolver ?? new NestedIgnoreResolver(options.workspaceRoot);
  return {
    rules: loaded.rules,
    overrides: loaded.overrides.overrides,
    evaluate(relPath: string) {
      return evaluatePathPrivacy({
        workspaceRoot: options.workspaceRoot,
        relPath,
        rules: loaded.rules,
        overrides: loaded.overrides.overrides,
        ignoreResolver,
      });
    },
  };
}
