import type {
  ExclusionReason,
  PrivacyClassification,
  PrivacyDecision,
  PrivacyRule,
  PrivacyRuleSource,
} from '../contracts/types';

export const PRIVACY_STRENGTH: Readonly<Record<PrivacyClassification, number>> = {
  never_index: 5,
  never_send_to_model: 4,
  metadata_only: 3,
  local_only: 2,
  normal: 1,
};

/** Source precedence when strengths are equal (lower index = higher priority). */
export const PRIVACY_SOURCE_RANK: Readonly<Record<PrivacyRuleSource, number>> = {
  override: 0,
  global: 1,
  workspace: 2,
  mergecoreignore: 3,
  gitignore: 4,
  vscode: 5,
  default: 6,
};

export function allowsRetrieval(c: PrivacyClassification): boolean {
  return c !== 'never_index';
}

export function allowsModelEvidence(c: PrivacyClassification): boolean {
  return c === 'normal';
}

export function allowsContentStorage(c: PrivacyClassification): boolean {
  return c === 'normal' || c === 'local_only' || c === 'never_send_to_model';
}

export function allowsSymbolIndex(c: PrivacyClassification): boolean {
  return c !== 'never_index';
}

export function isIncluded(c: PrivacyClassification): boolean {
  return c !== 'never_index';
}

export function exclusionReasonForSource(
  source: PrivacyRuleSource
): ExclusionReason {
  switch (source) {
    case 'global':
      return 'global-exclusion';
    case 'workspace':
      return 'workspace-exclusion';
    case 'mergecoreignore':
      return 'mergecoreignore';
    case 'gitignore':
      return 'gitignore';
    default:
      return 'privacy-rule';
  }
}

export function decisionFromClassification(
  path: string,
  classification: PrivacyClassification,
  meta: {
    readonly matchedPattern?: string;
    readonly ruleSource: PrivacyRuleSource;
    readonly rulePath?: string;
    readonly detail?: string;
    readonly languageScoped?: boolean;
  }
): PrivacyDecision {
  let exclusionReason: ExclusionReason | undefined;
  if (classification === 'never_index') {
    exclusionReason = exclusionReasonForSource(meta.ruleSource);
  } else if (meta.languageScoped && classification !== 'normal') {
    exclusionReason = 'language-exclusion';
  } else if (classification !== 'normal') {
    exclusionReason =
      meta.ruleSource === 'global'
        ? 'global-exclusion'
        : meta.ruleSource === 'workspace'
          ? 'workspace-exclusion'
          : 'privacy-rule';
  }

  return {
    path: path.replace(/\\/g, '/'),
    classification,
    matchedPattern: meta.matchedPattern,
    ruleSource: meta.ruleSource,
    rulePath: meta.rulePath,
    exclusionReason,
    allowsRetrieval: allowsRetrieval(classification),
    allowsModelEvidence: allowsModelEvidence(classification),
    allowsContentStorage: allowsContentStorage(classification),
    allowsSymbolIndex: allowsSymbolIndex(classification),
    included: isIncluded(classification),
    detail: meta.detail,
  };
}

export function compareRulePriority(
  a: { classification: PrivacyClassification; source: PrivacyRuleSource },
  b: { classification: PrivacyClassification; source: PrivacyRuleSource }
): number {
  const strengthDiff =
    PRIVACY_STRENGTH[b.classification] - PRIVACY_STRENGTH[a.classification];
  if (strengthDiff !== 0) {
    return strengthDiff;
  }
  return PRIVACY_SOURCE_RANK[a.source] - PRIVACY_SOURCE_RANK[b.source];
}

export function wouldWeaken(
  current: PrivacyClassification,
  proposed: PrivacyClassification
): boolean {
  return PRIVACY_STRENGTH[proposed] < PRIVACY_STRENGTH[current];
}

/** True when classification may be indexed but must not leave as model evidence. */
export function blocksModelEvidence(c: PrivacyClassification): boolean {
  return c === 'never_send_to_model' || c === 'local_only' || c === 'metadata_only' || c === 'never_index';
}

export type { PrivacyRule };
