import type { HoverSummary } from './hover-summary';
import { claimLabel } from './hover-summary';

export const HOVER_COMMANDS = {
  openSource: 'mergecore.hover.openSource',
  openExplanation: 'mergecore.hover.openExplanation',
  viewCallers: 'mergecore.hover.viewCallers',
  viewDependencies: 'mergecore.hover.viewDependencies',
  viewRelatedTests: 'mergecore.hover.viewRelatedTests',
  viewInstructions: 'mergecore.hover.viewApplicableInstructions',
  generateTaskContext: 'mergecore.hover.generateTaskContext',
} as const;

export type HoverCommandId = (typeof HOVER_COMMANDS)[keyof typeof HOVER_COMMANDS];

export const HOVER_ENABLED_COMMANDS: readonly string[] = Object.values(HOVER_COMMANDS);

export interface HoverCommandArgs {
  readonly workspaceRoot: string;
  readonly symbolId: string;
  readonly path: string;
  readonly startLine: number;
  readonly endLine: number;
  readonly name: string;
}

function cmdLink(command: string, args: HoverCommandArgs, label: string): string {
  const encoded = encodeURIComponent(JSON.stringify(args));
  return `[${label}](command:${command}?${encoded})`;
}

/**
 * Compact progressive hover markdown — not a wall of text.
 */
export function formatHoverMarkdown(
  summary: HoverSummary,
  workspaceRoot: string
): string {
  const args: HoverCommandArgs = {
    workspaceRoot,
    symbolId: summary.symbolId,
    path: summary.path,
    startLine: summary.startLine,
    endLine: summary.endLine,
    name: summary.name,
  };

  const lines: string[] = [];
  lines.push(`### \`${summary.name}\` · ${summary.kind}`);
  if (summary.signature) {
    lines.push(`\`${summary.signature.slice(0, 120)}\``);
  }
  lines.push('');
  lines.push(`**Purpose** · ${claimLabel(summary.purpose)}`);
  lines.push(`**Role** · ${claimLabel(summary.role)}`);
  lines.push(`**In** · ${claimLabel(summary.inputs)} → **Out** · ${claimLabel(summary.output)}`);
  lines.push(
    `**Deps** · ${summary.dependencyCount} · **Callers** · ${summary.callerCount} · **Tests** · ${summary.relatedTestCount}`
  );

  if (summary.risks.length > 0) {
    const riskBits = summary.risks.map((r) => r.label).join(' · ');
    lines.push(`**Risk indicators** · ${riskBits} _(indicators, not confirmed issues)_`);
  }

  lines.push(
    `**Confidence** · ${summary.confidence} · ${summary.analysis}`
  );

  // Tiny evidence samples (max 3)
  const evidenceBits: string[] = [];
  if (summary.callers[0]) {
    evidenceBits.push(`caller \`${summary.callers[0].label}\``);
  }
  if (summary.relatedTests[0]) {
    evidenceBits.push(`test \`${summary.relatedTests[0].path}\``);
  }
  if (summary.instructions[0]) {
    evidenceBits.push(`instr \`${summary.instructions[0].path}\``);
  }
  if (evidenceBits.length > 0) {
    lines.push(`**Evidence** · ${evidenceBits.join(' · ')}`);
  }

  lines.push('');
  lines.push(
    [
      cmdLink(HOVER_COMMANDS.openSource, args, 'Open source'),
      cmdLink(HOVER_COMMANDS.viewCallers, args, 'Callers'),
      cmdLink(HOVER_COMMANDS.viewDependencies, args, 'Dependencies'),
      cmdLink(HOVER_COMMANDS.viewRelatedTests, args, 'Tests'),
      cmdLink(HOVER_COMMANDS.viewInstructions, args, 'Instructions'),
      cmdLink(HOVER_COMMANDS.openExplanation, args, 'Full explanation'),
      cmdLink(HOVER_COMMANDS.generateTaskContext, args, 'Task context'),
    ].join(' · ')
  );

  lines.push('');
  lines.push('---');
  lines.push('_MergeCore · deterministic hover · model not used_');

  return lines.join('\n');
}
