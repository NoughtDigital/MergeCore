import type { ExplainerPorts } from '../../infrastructure/explain/explainer';
import type { ModelPorts } from '../../infrastructure/explain/model-ports';
import { modelErrorUserMessage } from '../../infrastructure/explain/model-ports';
import { enhanceWithValidatedClaims } from '../../infrastructure/explain/enhance-with-validated-claims';
import { MODEL_SYSTEM_GUARDS } from '../../infrastructure/explain/model-prompt-guards';
import {
  validateAndStripCitations,
  validateModelClaimsAgainstEvidence,
} from './citation-validate';
import type { SelectedCodeExplanation } from './explain-selected-assemble';
import type { ExplainScope } from './explain-scope';
import {
  fenceEvidence,
  MERGECORE_SAFETY_RULES,
  sanitiseEvidenceText,
} from './prompt-safety';

const REQUIRED_H1 = [
  'Purpose',
  'Architectural role',
  'Inputs and outputs',
  'Direct dependencies',
  'Callers and dependents',
  'Applicable instructions',
  'Related tests',
  'Risk considerations',
  'Confidence',
  'Sources',
] as const;

function modelBanner(mode: string): string {
  if (mode === 'local') {
    return '> **Local model:** Only the minimum selected evidence was sent. Claims without valid evidence IDs were rejected. Deterministic analysis remains the source of truth for structure.';
  }
  if (mode === 'external') {
    return '> **External model:** Repository evidence left this machine. Claims without valid evidence IDs were rejected.';
  }
  return '> **Model transmission:** A provider model was used. Claims without valid evidence IDs were rejected.';
}

export function auditSelectedCodeExplanation(markdown: string): {
  readonly ok: boolean;
  readonly reasons: readonly string[];
} {
  const reasons: string[] = [];
  for (const h of REQUIRED_H1) {
    if (!markdown.includes(`# ${h}`)) {
      reasons.push(`missing-section:${h}`);
    }
  }
  if (markdown.length < 200) {
    reasons.push('too-short');
  }
  return { ok: reasons.length === 0, reasons };
}

function buildEvidencePayload(
  scope: ExplainScope,
  explanation: SelectedCodeExplanation
): { readonly body: string } {
  const lines: string[] = [];
  lines.push(`Selection path: ${scope.relPath}`);
  lines.push(`Range: L${scope.range.startLine}-${scope.range.endLine}`);
  if (scope.symbol) {
    lines.push(
      `Symbol: ${scope.symbol.name} (${scope.symbol.kind}) id=${scope.symbol.id}`
    );
  }
  const code = sanitiseEvidenceText(scope.selectedText.slice(0, 2500)).text;
  lines.push('Selected code:');
  lines.push('```');
  lines.push(code);
  lines.push('```');
  lines.push('');
  lines.push('Evidence catalogue — cite ONLY these evidenceIds (never invent paths/lines):');
  const attributed = explanation.attributedSources ?? [];
  for (const s of attributed.slice(0, 32)) {
    lines.push(
      `- ${s.evidenceId}: ${s.path}#L${s.startLine}${s.endLine !== s.startLine ? `-L${s.endLine}` : ''} (${s.sourceType})`
    );
  }
  if (attributed.length === 0) {
    for (const s of explanation.sources.slice(0, 24)) {
      lines.push(
        `- ${s.path}#L${s.startLine}${s.endLine !== s.startLine ? `-L${s.endLine}` : ''} · ${s.label}`
      );
    }
  }
  lines.push('');
  lines.push('Deterministic section drafts (evidence-labelled; refine, do not invent):');
  for (const section of explanation.sections) {
    lines.push(`## ${section.title}`);
    for (const b of section.bullets.slice(0, 12)) {
      lines.push(b);
    }
  }
  return {
    body: fenceEvidence(lines.join('\n')),
  };
}

function foldClaimsMarkdown(
  explanation: SelectedCodeExplanation,
  claimTexts: readonly string[],
  banner: string,
  fallbackNote?: string
): string {
  const sourcesSection = explanation.sections.find((s) => s.title === 'Sources');
  return [
    banner,
    fallbackNote ? `> ${fallbackNote}` : '',
    '',
    `# ${explanation.title.replace(/^#\s*/, '')}`,
    '',
    '# Purpose',
    '',
    ...claimTexts.map((t) => `- ${t}`),
    '',
    '# Confidence',
    '',
    '- Model claims validated against evidence IDs only (confidence band, not a probability).',
    '',
    '# Sources',
    '',
    ...(sourcesSection?.bullets ?? []),
  ]
    .filter(Boolean)
    .join('\n');
}

/**
 * Optionally enhance a deterministic explanation via the local/provider model.
 * Returns undefined on any failure so callers can keep the deterministic result.
 */
export async function enhanceSelectedExplanationWithModel(input: {
  readonly scope: ExplainScope;
  readonly explanation: SelectedCodeExplanation;
  readonly ports: ExplainerPorts | ModelPorts;
  readonly signal?: AbortSignal;
}): Promise<SelectedCodeExplanation | undefined> {
  const ports = input.ports as ModelPorts;
  const mode = 'mode' in ports ? ports.mode : 'local';
  const banner = modelBanner(typeof mode === 'string' ? mode : 'local');

  if ('complete' in ports && typeof ports.complete === 'function') {
    const { body } = buildEvidencePayload(input.scope, input.explanation);
    const enhanced = await enhanceWithValidatedClaims({
      ports,
      evidence: input.explanation.attributedSources ?? [],
      purpose: 'Explain Selected Code',
      signal: input.signal,
      systemExtra: [
        MERGECORE_SAFETY_RULES,
        'Summarise and improve wording of selected evidence only.',
      ].join('\n'),
      userPrompt: [
        'Enhance using only the fenced evidence. Return JSON claims with evidenceIds.',
        '',
        body,
      ].join('\n'),
    });
    if (!enhanced.ok) {
      return undefined;
    }
    return {
      ...input.explanation,
      markdown: foldClaimsMarkdown(
        input.explanation,
        enhanced.acceptedClaimTexts,
        banner,
        enhanced.rejectedCount > 0
          ? `${enhanced.rejectedCount} claim(s) rejected for missing/unknown evidence IDs.`
          : undefined
      ),
      usedModel: true,
      modelTransmissionVisible: true,
      modelKind: mode === 'external' ? 'external' : 'local',
    };
  }

  // Legacy ExplainerPorts path
  const available = await input.ports.isAvailable(input.signal);
  if (!available) {
    return undefined;
  }

  const { body } = buildEvidencePayload(input.scope, input.explanation);
  const system = [
    MODEL_SYSTEM_GUARDS,
    'Return JSON claims that reference evidenceIds from the catalogue only.',
    MERGECORE_SAFETY_RULES,
  ].join('\n');

  const content = await input.ports.chat(
    [
      { role: 'system', content: system },
      {
        role: 'user',
        content: `Enhance using only the fenced evidence. Return JSON claims with evidenceIds.\n\n${body}`,
      },
    ],
    input.signal
  );
  if (!content?.trim()) {
    return undefined;
  }

  const claimValidated = validateModelClaimsAgainstEvidence(
    content.trim(),
    input.explanation.attributedSources ?? []
  );

  let markdown: string;
  if ((claimValidated.acceptedClaimTexts?.length ?? 0) > 0) {
    markdown = foldClaimsMarkdown(
      input.explanation,
      claimValidated.acceptedClaimTexts!,
      banner
    );
  } else {
    const audit = auditSelectedCodeExplanation(content);
    if (!audit.ok) {
      void modelErrorUserMessage;
      return undefined;
    }
    const validated = validateAndStripCitations(
      content.trim(),
      input.explanation.evidenceRefs
    );
    markdown = validated.markdown;
    if (!markdown.includes('Model transmission') && !markdown.includes('Local model')) {
      markdown = `${banner}\n\n${markdown}`;
    }
  }

  return {
    ...input.explanation,
    markdown,
    usedModel: true,
    modelTransmissionVisible: true,
    modelKind: mode === 'external' ? 'external' : 'local',
  };
}
