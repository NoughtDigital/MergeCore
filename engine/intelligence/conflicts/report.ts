import type {
  ContextConflictFinding,
  ContextConflictScanResult,
  ExtractedConflictRule,
} from './types';

export function formatContextConflictsMarkdown(
  result: ContextConflictScanResult
): string {
  const lines: string[] = [
    '# MergeCore · Context conflicts',
    '',
    `Workspace: \`${result.workspaceRoot}\``,
    '',
    `- Rules scanned: **${result.rulesScanned}**`,
    `- Conflicts reported: **${result.findings.length}**`,
    `- Extracted rules awaiting review: **${result.extractedPending}**`,
    '',
  ];

  for (const n of result.notes) {
    lines.push(`_${n}_`, '');
  }

  if (result.findings.length === 0) {
    lines.push('No documented-rule conflicts with observed implementation were found.', '');
    return lines.join('\n');
  }

  for (const f of result.findings) {
    lines.push(...formatFindingMarkdown(f), '');
  }

  return lines.join('\n');
}

export function formatFindingMarkdown(f: ContextConflictFinding): string[] {
  const lines: string[] = [
    `## ${f.message}`,
    '',
    `- Rule id: \`${f.rule.id}\``,
    `- Detector: \`${f.detector}\``,
    `- Confidence: **${f.confidence}**`,
    `- User-confirmed: **${f.userConfirmed ? 'yes' : 'no'}**`,
    f.ignored ? '- Status: **ignored**' : undefined,
    '',
    '### Documented rule',
    '',
    `> ${f.documentedRule.text}`,
    '',
    `- Source: \`${f.documentedRule.path}:${f.documentedRule.startLine}\`` +
      (f.documentedRule.endLine !== f.documentedRule.startLine
        ? `–${f.documentedRule.endLine}`
        : ''),
    '',
    '### Observed implementation',
    '',
  ].filter((x): x is string => x !== undefined);

  for (const o of f.observedCode.slice(0, 40)) {
    lines.push(
      `- \`${o.path}:${o.startLine}\` — ${o.detail}`,
      o.excerpt ? `  - Excerpt: \`${o.excerpt.slice(0, 160)}\`` : ''
    );
  }

  lines.push('', '### Affected files', '');
  for (const p of f.affectedFiles) {
    lines.push(`- \`${p}\``);
  }

  return lines;
}

export function formatExtractedRulesMarkdown(
  rules: readonly ExtractedConflictRule[]
): string {
  const lines: string[] = [
    '# MergeCore · Extracted conflict rules',
    '',
    'Candidates from binding instruction documents. Confirm before they affect scans.',
    'Vague prose is marked ambiguous and never becomes mandatory without edits.',
    '',
  ];

  if (rules.length === 0) {
    lines.push('_No extracted candidates._', '');
    return lines.join('\n');
  }

  for (const r of rules) {
    lines.push(
      `## \`${r.id}\``,
      '',
      `- Status: **${r.status}**`,
      `- Ambiguous: **${r.ambiguous ? 'yes' : 'no'}**`,
      `- Generated memory: **${r.fromGeneratedMemory ? 'yes' : 'no'}**`,
      `- Detector: \`${r.suggestedDetector ?? '(none — needs edit)'}\``,
      `- Applies to: ${r.appliesTo.map((g) => `\`${g}\``).join(', ') || '_none_'}`,
      `- Source: \`${r.source.path}:${r.source.startLine}\``,
      '',
      'Original text:',
      '',
      `> ${r.originalText}`,
      ''
    );
  }

  return lines.join('\n');
}
