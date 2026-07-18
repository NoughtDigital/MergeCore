import type { OllamaChatMessage } from './ollama.client';

export type ModelPortMode = 'deterministic' | 'local' | 'external';

export type ModelHealthReason =
  | 'server_unavailable'
  | 'model_missing'
  | 'unauthorised'
  | 'deterministic';

export interface ModelHealth {
  readonly ok: boolean;
  readonly reason?: ModelHealthReason;
  readonly models?: readonly string[];
  readonly detail?: string;
}

export type ModelErrorKind =
  | 'server_unavailable'
  | 'model_missing'
  | 'context_too_large'
  | 'malformed_json'
  | 'timeout'
  | 'cancelled'
  | 'partial_stream_failure'
  | 'unauthorised'
  | 'unknown';

export class ModelClientError extends Error {
  constructor(
    readonly kind: ModelErrorKind,
    message: string,
    readonly cause?: unknown
  ) {
    super(message);
    this.name = 'ModelClientError';
  }
}

export interface ModelCompleteRequest {
  readonly messages: readonly OllamaChatMessage[];
  readonly expectJson?: boolean;
  readonly maxTokens?: number;
  readonly purpose?: string;
  /** Estimated input tokens; when over maxContextTokens, client fails preflight. */
  readonly estimatedInputTokens?: number;
}

export interface ModelCompleteResult {
  readonly content: string;
  readonly finishReason?: string;
}

export interface ModelStreamEvent {
  readonly delta?: string;
  readonly done?: boolean;
  readonly error?: ModelClientError;
}

/**
 * Vendor-neutral model ports used by explain / task-context / hover enhance.
 * Includes legacy chat/isAvailable for existing call sites.
 */
export interface ModelPorts {
  readonly mode: ModelPortMode;
  readonly providerId: string;
  readonly model: string;
  readonly dataRemainsLocal: boolean;
  readonly supportsStructuredOutput: boolean;
  readonly supportsStreaming: boolean;
  readonly maxContextTokens: number;
  health(signal?: AbortSignal): Promise<ModelHealth>;
  complete(
    req: ModelCompleteRequest,
    signal?: AbortSignal
  ): Promise<ModelCompleteResult>;
  completeStream?(
    req: ModelCompleteRequest,
    signal?: AbortSignal
  ): AsyncIterable<ModelStreamEvent>;
  /** Legacy ExplainerPorts.chat */
  chat(
    messages: readonly OllamaChatMessage[],
    signal?: AbortSignal
  ): Promise<string | undefined>;
  isAvailable(signal?: AbortSignal): Promise<boolean>;
}

export function estimateTokensFromText(text: string): number {
  return Math.max(1, Math.ceil(text.length / 4));
}

export function estimateTokensFromMessages(
  messages: readonly OllamaChatMessage[]
): number {
  return messages.reduce((sum, m) => sum + estimateTokensFromText(m.content), 0);
}

export function modelErrorUserMessage(err: unknown): string {
  if (err instanceof ModelClientError) {
    switch (err.kind) {
      case 'server_unavailable':
        return 'Local model server unreachable — using deterministic output.';
      case 'model_missing':
        return 'Configured model not found on server — using deterministic output.';
      case 'context_too_large':
        return 'Evidence exceeds max context — using deterministic output.';
      case 'malformed_json':
        return 'Model returned invalid claims JSON — using deterministic output.';
      case 'timeout':
        return 'Local model timed out — using deterministic output.';
      case 'cancelled':
        return 'Model request cancelled — using deterministic output.';
      case 'partial_stream_failure':
        return 'Stream interrupted — using deterministic output.';
      case 'unauthorised':
        return 'Model server rejected credentials — using deterministic output.';
      default:
        return `${err.message} — using deterministic output.`;
    }
  }
  if (err instanceof Error && err.name === 'AbortError') {
    return 'Model request cancelled — using deterministic output.';
  }
  return 'Model enhancement failed — using deterministic output.';
}

export const unavailableModelPorts: ModelPorts = {
  mode: 'deterministic',
  providerId: 'none',
  model: '',
  dataRemainsLocal: true,
  supportsStructuredOutput: false,
  supportsStreaming: false,
  maxContextTokens: 0,
  async health() {
    return { ok: false, reason: 'deterministic' };
  },
  async complete() {
    throw new ModelClientError('server_unavailable', 'No model provider configured');
  },
  async chat() {
    return undefined;
  },
  async isAvailable() {
    return false;
  },
};
