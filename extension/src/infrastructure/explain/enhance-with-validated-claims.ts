import {
  evidenceMapById,
  parseModelClaimsJson,
  validateModelClaimBundle,
  type SourceReference,
} from '@mergecore/intelligence';
import {
  ModelClientError,
  modelErrorUserMessage,
  type ModelPorts,
} from './model-ports';
import { MODEL_SYSTEM_GUARDS, claimsJsonInstruction } from './model-prompt-guards';
import type { OllamaChatMessage } from './ollama.client';

export interface EnhanceWithValidatedClaimsInput {
  readonly ports: ModelPorts;
  readonly evidence: readonly SourceReference[];
  readonly userPrompt: string;
  readonly systemExtra?: string;
  readonly signal?: AbortSignal;
  readonly purpose?: string;
  /** Force low certainty on accepted claims (ambiguous docs). */
  readonly forceLowCertainty?: boolean;
}

export interface EnhanceWithValidatedClaimsResult {
  readonly ok: boolean;
  readonly content?: string;
  readonly acceptedClaimTexts: readonly string[];
  readonly rejectedCount: number;
  readonly fallbackMessage?: string;
  readonly errorKind?: string;
}

/**
 * Run a model completion expecting evidence-ID JSON claims; reject unknowns.
 * On any failure, returns ok:false with a deterministic-fallback message.
 */
export async function enhanceWithValidatedClaims(
  input: EnhanceWithValidatedClaimsInput
): Promise<EnhanceWithValidatedClaimsResult> {
  const evidence = input.evidence.filter((e) => e.evidenceId);
  if (evidence.length === 0) {
    return {
      ok: false,
      acceptedClaimTexts: [],
      rejectedCount: 0,
      fallbackMessage: 'No attributed evidence IDs available — using deterministic output.',
    };
  }

  const catalogue = evidence
    .slice(0, 48)
    .map(
      (s) =>
        `- ${s.evidenceId}: ${s.path}#L${s.startLine}${
          s.endLine !== s.startLine ? `-L${s.endLine}` : ''
        } (${s.sourceType})`
    )
    .join('\n');

  const system = [
    MODEL_SYSTEM_GUARDS,
    input.systemExtra,
    claimsJsonInstruction(),
    input.forceLowCertainty
      ? 'All claims in this task are ambiguous — set certainty to "low".'
      : undefined,
  ]
    .filter(Boolean)
    .join('\n');

  const user = [
    input.userPrompt,
    '',
    'Evidence catalogue — cite ONLY these evidenceIds:',
    catalogue,
  ].join('\n');

  const messages: OllamaChatMessage[] = [
    { role: 'system', content: system },
    { role: 'user', content: user },
  ];

  try {
    const health = await input.ports.health(input.signal);
    if (!health.ok) {
      const kind =
        health.reason === 'model_missing'
          ? 'model_missing'
          : health.reason === 'unauthorised'
            ? 'unauthorised'
            : 'server_unavailable';
      return {
        ok: false,
        acceptedClaimTexts: [],
        rejectedCount: 0,
        errorKind: kind,
        fallbackMessage: modelErrorUserMessage(new ModelClientError(kind, health.detail ?? '')),
      };
    }

    const result = await input.ports.complete(
      {
        messages,
        expectJson: true,
        purpose: input.purpose,
      },
      input.signal
    );

    const bundle = parseModelClaimsJson(result.content);
    if (!bundle) {
      return {
        ok: false,
        acceptedClaimTexts: [],
        rejectedCount: 0,
        errorKind: 'malformed_json',
        fallbackMessage: modelErrorUserMessage(
          new ModelClientError('malformed_json', 'Could not parse claims JSON')
        ),
      };
    }

    const forced = input.forceLowCertainty
      ? {
          claims: bundle.claims.map((c) => ({ ...c, certainty: 'low' as const })),
        }
      : bundle;

    const validated = validateModelClaimBundle(forced, evidenceMapById(evidence));
    const acceptedClaimTexts = validated.accepted.map((c) => c.text);
    if (acceptedClaimTexts.length === 0) {
      return {
        ok: false,
        acceptedClaimTexts: [],
        rejectedCount: validated.rejected.length,
        errorKind: 'malformed_json',
        fallbackMessage:
          'Model claims lacked valid evidence IDs — using deterministic output.',
      };
    }

    return {
      ok: true,
      content: result.content,
      acceptedClaimTexts,
      rejectedCount: validated.rejected.length,
    };
  } catch (err) {
    return {
      ok: false,
      acceptedClaimTexts: [],
      rejectedCount: 0,
      errorKind: err instanceof ModelClientError ? err.kind : 'unknown',
      fallbackMessage: modelErrorUserMessage(err),
    };
  }
}
