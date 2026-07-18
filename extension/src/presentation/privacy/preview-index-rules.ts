import {
  previewIndexRules,
  type IndexRulePreviewRow,
  type PreviewIndexRulesResult,
} from '@mergecore/intelligence';

function yesNo(v: boolean): string {
  return v ? 'yes' : 'no';
}

function formatRow(row: IndexRulePreviewRow): string {
  const parts = [
    `\`${row.path}\``,
    row.classification,
    row.matchedPattern ? `pattern=\`${row.matchedPattern}\`` : undefined,
    `source=${row.ruleSource}`,
    row.rulePath ? `file=\`${row.rulePath}\`` : undefined,
    `retrieval=${yesNo(row.allowsRetrieval)}`,
    `model=${yesNo(row.allowsModelEvidence)}`,
  ].filter(Boolean);
  return `- ${parts.join(' · ')}`;
}

export function formatPreviewIndexRulesMarkdown(
  result: PreviewIndexRulesResult
): string {
  const lines: string[] = [
    '# MergeCore · Preview Index Rules',
    '',
    `Workspace: \`${result.workspaceRoot}\``,
    '',
    `- Included: **${result.included.length}**`,
    `- Restricted (local / never send): **${result.restricted.length}**`,
    `- Excluded: **${result.excluded.length}**`,
    '',
  ];

  if (result.restricted.length > 0) {
    lines.push('## Restricted (local only / never send to model)', '');
    for (const row of result.restricted.slice(0, 400)) {
      lines.push(formatRow(row));
    }
    lines.push('');
  }

  lines.push('## Included', '');
  if (result.included.length === 0) {
    lines.push('_None._', '');
  } else {
    for (const row of result.included
      .filter((r) => r.allowsModelEvidence)
      .slice(0, 500)) {
      lines.push(formatRow(row));
    }
    lines.push('');
  }

  lines.push('## Excluded', '');
  if (result.excluded.length === 0) {
    lines.push('_None._', '');
  } else {
    for (const row of result.excluded.slice(0, 500)) {
      lines.push(formatRow(row));
    }
    lines.push('');
  }

  return lines.join('\n');
}

export async function runPreviewIndexRules(
  workspaceRoot: string,
  options?: {
    readonly maxFiles?: number;
    readonly vscodeExtraExclusions?: readonly string[];
    readonly signal?: AbortSignal;
  }
): Promise<PreviewIndexRulesResult> {
  return previewIndexRules({
    workspaceRoot,
    maxFiles: options?.maxFiles,
    vscodeExtraExclusions: options?.vscodeExtraExclusions,
    signal: options?.signal,
  });
}
