import type { ModelPortMode } from './model-ports';
import { estimateTokensFromMessages, estimateTokensFromText } from './model-ports';
import type { OllamaChatMessage } from './ollama.client';

export interface ModelRequestPreview {
  readonly providerType: ModelPortMode | 'deterministic';
  readonly model: string;
  readonly estimatedInputChars: number;
  readonly estimatedInputTokens: number;
  readonly evidenceFiles: readonly string[];
  readonly excludedEvidence: readonly string[];
  readonly dataRemainsLocal: boolean;
  readonly purpose: string;
  readonly createdAt: string;
}

export function buildModelRequestPreview(input: {
  readonly providerType: ModelPortMode | 'deterministic';
  readonly model: string;
  readonly dataRemainsLocal: boolean;
  readonly purpose: string;
  readonly messages?: readonly OllamaChatMessage[];
  readonly evidenceFiles: readonly string[];
  readonly excludedEvidence?: readonly string[];
  readonly rawBodyChars?: number;
}): ModelRequestPreview {
  const estimatedInputChars =
    input.rawBodyChars ??
    (input.messages
      ? input.messages.reduce((n, m) => n + m.content.length, 0)
      : 0);
  const estimatedInputTokens = input.messages
    ? estimateTokensFromMessages(input.messages)
    : estimateTokensFromText('x'.repeat(estimatedInputChars));
  return {
    providerType: input.providerType,
    model: input.model,
    estimatedInputChars,
    estimatedInputTokens,
    evidenceFiles: [...new Set(input.evidenceFiles)].sort((a, b) =>
      a.localeCompare(b)
    ),
    excludedEvidence: [...(input.excludedEvidence ?? [])].sort((a, b) =>
      a.localeCompare(b)
    ),
    dataRemainsLocal: input.dataRemainsLocal,
    purpose: input.purpose,
    createdAt: new Date().toISOString(),
  };
}

export function formatModelRequestPreviewMarkdown(
  preview: ModelRequestPreview
): string {
  const lines = [
    '# MergeCore model request preview',
    '',
    `- **Provider type:** ${preview.providerType}`,
    `- **Model:** ${preview.model || '(none)'}`,
    `- **Purpose:** ${preview.purpose}`,
    `- **Estimated input size:** ${preview.estimatedInputChars} chars (~${preview.estimatedInputTokens} tokens)`,
    `- **Data remains local:** ${preview.dataRemainsLocal ? 'yes' : 'no'}`,
    `- **Created:** ${preview.createdAt}`,
    '',
    '## Evidence files involved',
    '',
  ];
  if (preview.evidenceFiles.length === 0) {
    lines.push('_None._');
  } else {
    for (const p of preview.evidenceFiles.slice(0, 80)) {
      lines.push(`- \`${p}\``);
    }
  }
  lines.push('', '## Excluded by privacy rules', '');
  if (preview.excludedEvidence.length === 0) {
    lines.push('_None._');
  } else {
    for (const p of preview.excludedEvidence.slice(0, 80)) {
      lines.push(`- \`${p}\``);
    }
  }
  lines.push(
    '',
    '_This preview lists paths and sizes only — no file bodies._'
  );
  return lines.join('\n');
}
