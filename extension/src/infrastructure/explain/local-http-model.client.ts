import type { OllamaChatMessage } from './ollama.client';
import {
  estimateTokensFromMessages,
  ModelClientError,
  type ModelCompleteRequest,
  type ModelCompleteResult,
  type ModelHealth,
  type ModelPorts,
  type ModelStreamEvent,
} from './model-ports';

export interface LocalHttpModelClientOptions {
  readonly baseUrl: string;
  readonly model: string;
  readonly timeoutMs?: number;
  readonly maxContextTokens?: number;
  readonly supportsStructuredOutput?: boolean;
  readonly supportsStreaming?: boolean;
  /** Optional bearer token — omitted when empty. */
  readonly apiKey?: string;
  readonly availabilityTtlMs?: number;
}

function joinUrl(base: string, path: string): string {
  const b = base.replace(/\/+$/, '');
  const p = path.startsWith('/') ? path : `/${path}`;
  return `${b}${p}`;
}

/**
 * Vendor-neutral OpenAI-compatible local HTTP client (`/v1/models`, `/v1/chat/completions`).
 */
export class LocalHttpModelClient implements ModelPorts {
  readonly mode = 'local' as const;
  readonly providerId = 'local-http';
  readonly dataRemainsLocal: boolean;
  readonly supportsStructuredOutput: boolean;
  readonly supportsStreaming: boolean;
  readonly maxContextTokens: number;

  private availabilityCache:
    | { readonly health: ModelHealth; readonly checkedAt: number }
    | undefined;

  constructor(private readonly opts: LocalHttpModelClientOptions) {
    this.dataRemainsLocal = true;
    this.supportsStructuredOutput = opts.supportsStructuredOutput !== false;
    this.supportsStreaming = opts.supportsStreaming !== false;
    this.maxContextTokens = opts.maxContextTokens ?? 8192;
  }

  get model(): string {
    return this.opts.model;
  }

  async health(signal?: AbortSignal): Promise<ModelHealth> {
    const ttl = this.opts.availabilityTtlMs ?? 45_000;
    const cached = this.availabilityCache;
    if (cached && Date.now() - cached.checkedAt < ttl) {
      return cached.health;
    }
    try {
      const res = await this.fetch(joinUrl(this.opts.baseUrl, '/models'), { method: 'GET' }, signal);
      if (res.status === 401 || res.status === 403) {
        const health: ModelHealth = { ok: false, reason: 'unauthorised' };
        this.availabilityCache = { health, checkedAt: Date.now() };
        return health;
      }
      if (!res.ok) {
        const health: ModelHealth = {
          ok: false,
          reason: 'server_unavailable',
          detail: `HTTP ${res.status}`,
        };
        this.availabilityCache = { health, checkedAt: Date.now() };
        return health;
      }
      const json = (await res.json()) as {
        data?: Array<{ id?: string }>;
        models?: Array<{ name?: string; id?: string }>;
      };
      const models = [
        ...(json.data ?? []).map((m) => m.id).filter((id): id is string => Boolean(id)),
        ...(json.models ?? [])
          .map((m) => m.id ?? m.name)
          .filter((id): id is string => Boolean(id)),
      ];
      const hasModel =
        models.length === 0 ||
        models.some(
          (id) =>
            id === this.opts.model ||
            id.endsWith(`:${this.opts.model}`) ||
            id.startsWith(`${this.opts.model}:`)
        );
      const health: ModelHealth = hasModel
        ? { ok: true, models }
        : {
            ok: false,
            reason: 'model_missing',
            models,
            detail: `Model ${this.opts.model} not listed`,
          };
      this.availabilityCache = { health, checkedAt: Date.now() };
      return health;
    } catch (err) {
      if (isAbort(err)) {
        throw new ModelClientError('cancelled', 'Health check cancelled', err);
      }
      const health: ModelHealth = {
        ok: false,
        reason: 'server_unavailable',
        detail: err instanceof Error ? err.message : String(err),
      };
      this.availabilityCache = { health, checkedAt: Date.now() };
      return health;
    }
  }

  async isAvailable(signal?: AbortSignal): Promise<boolean> {
    const h = await this.health(signal);
    return h.ok;
  }

  async chat(
    messages: readonly OllamaChatMessage[],
    signal?: AbortSignal
  ): Promise<string | undefined> {
    try {
      const result = await this.complete({ messages }, signal);
      return result.content;
    } catch {
      return undefined;
    }
  }

  async complete(
    req: ModelCompleteRequest,
    signal?: AbortSignal
  ): Promise<ModelCompleteResult> {
    this.assertContextBudget(req);
    const health = await this.health(signal);
    if (!health.ok) {
      throw new ModelClientError(
        health.reason === 'model_missing'
          ? 'model_missing'
          : health.reason === 'unauthorised'
            ? 'unauthorised'
            : 'server_unavailable',
        health.detail ?? health.reason ?? 'Local model unavailable'
      );
    }

    const body: Record<string, unknown> = {
      model: this.opts.model,
      messages: req.messages.map((m) => ({ role: m.role, content: m.content })),
      stream: false,
      temperature: 0.2,
    };
    if (req.maxTokens) body.max_tokens = req.maxTokens;
    if (req.expectJson && this.supportsStructuredOutput) {
      body.response_format = { type: 'json_object' };
    }

    try {
      const res = await this.fetch(
        joinUrl(this.opts.baseUrl, '/chat/completions'),
        {
          method: 'POST',
          headers: this.headers(),
          body: JSON.stringify(body),
        },
        signal
      );
      if (res.status === 401 || res.status === 403) {
        throw new ModelClientError('unauthorised', `HTTP ${res.status}`);
      }
      if (res.status === 404) {
        throw new ModelClientError('model_missing', `HTTP ${res.status}`);
      }
      if (res.status === 413) {
        throw new ModelClientError('context_too_large', `HTTP ${res.status}`);
      }
      if (!res.ok) {
        throw new ModelClientError(
          'server_unavailable',
          `Local model HTTP ${res.status}`
        );
      }
      const json = (await res.json()) as {
        choices?: Array<{
          message?: { content?: string };
          finish_reason?: string;
        }>;
      };
      const content = json.choices?.[0]?.message?.content?.trim();
      if (!content) {
        throw new ModelClientError('malformed_json', 'Empty model content');
      }
      if (req.expectJson) {
        try {
          JSON.parse(stripJsonFence(content));
        } catch (err) {
          throw new ModelClientError('malformed_json', 'Invalid JSON from model', err);
        }
      }
      return {
        content,
        finishReason: json.choices?.[0]?.finish_reason,
      };
    } catch (err) {
      if (err instanceof ModelClientError) throw err;
      if (isAbort(err)) {
        throw new ModelClientError('cancelled', 'Request cancelled', err);
      }
      if (isTimeout(err)) {
        throw new ModelClientError('timeout', 'Local model timed out', err);
      }
      throw new ModelClientError(
        'server_unavailable',
        err instanceof Error ? err.message : String(err),
        err
      );
    }
  }

  async *completeStream(
    req: ModelCompleteRequest,
    signal?: AbortSignal
  ): AsyncIterable<ModelStreamEvent> {
    if (!this.supportsStreaming) {
      const result = await this.complete(req, signal);
      yield { delta: result.content, done: true };
      return;
    }
    this.assertContextBudget(req);
    const body: Record<string, unknown> = {
      model: this.opts.model,
      messages: req.messages.map((m) => ({ role: m.role, content: m.content })),
      stream: true,
      temperature: 0.2,
    };
    if (req.maxTokens) body.max_tokens = req.maxTokens;
    if (req.expectJson && this.supportsStructuredOutput) {
      body.response_format = { type: 'json_object' };
    }

    let res: Response;
    try {
      res = await this.fetch(
        joinUrl(this.opts.baseUrl, '/chat/completions'),
        {
          method: 'POST',
          headers: this.headers(),
          body: JSON.stringify(body),
        },
        signal
      );
    } catch (err) {
      if (isAbort(err)) {
        yield {
          error: new ModelClientError('cancelled', 'Stream cancelled', err),
          done: true,
        };
        return;
      }
      yield {
        error: new ModelClientError(
          isTimeout(err) ? 'timeout' : 'server_unavailable',
          err instanceof Error ? err.message : String(err),
          err
        ),
        done: true,
      };
      return;
    }

    if (!res.ok || !res.body) {
      yield {
        error: new ModelClientError(
          res.status === 404 ? 'model_missing' : 'server_unavailable',
          `HTTP ${res.status}`
        ),
        done: true,
      };
      return;
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    try {
      while (true) {
        if (signal?.aborted) {
          yield { error: new ModelClientError('cancelled', 'Stream cancelled'), done: true };
          return;
        }
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split(/\r?\n/);
        buffer = lines.pop() ?? '';
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed.startsWith('data:')) continue;
          const data = trimmed.slice(5).trim();
          if (data === '[DONE]') {
            yield { done: true };
            return;
          }
          try {
            const json = JSON.parse(data) as {
              choices?: Array<{ delta?: { content?: string } }>;
            };
            const delta = json.choices?.[0]?.delta?.content;
            if (delta) yield { delta };
          } catch {
            yield {
              error: new ModelClientError(
                'partial_stream_failure',
                'Malformed stream chunk'
              ),
              done: true,
            };
            return;
          }
        }
      }
      yield { done: true };
    } catch (err) {
      if (isAbort(err)) {
        yield { error: new ModelClientError('cancelled', 'Stream cancelled', err), done: true };
        return;
      }
      yield {
        error: new ModelClientError(
          'partial_stream_failure',
          err instanceof Error ? err.message : String(err),
          err
        ),
        done: true,
      };
    } finally {
      try {
        reader.releaseLock();
      } catch {
        // ignore
      }
    }
  }

  private assertContextBudget(req: ModelCompleteRequest): void {
    const estimated =
      req.estimatedInputTokens ?? estimateTokensFromMessages(req.messages);
    if (estimated > this.maxContextTokens) {
      throw new ModelClientError(
        'context_too_large',
        `Estimated ${estimated} tokens exceeds max ${this.maxContextTokens}`
      );
    }
  }

  private headers(): Record<string, string> {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    const key = this.opts.apiKey?.trim();
    if (key) headers.Authorization = `Bearer ${key}`;
    return headers;
  }

  private async fetch(
    url: string,
    init: RequestInit,
    signal?: AbortSignal
  ): Promise<Response> {
    const timeoutMs = this.opts.timeoutMs ?? 45_000;
    const controller = new AbortController();
    const onAbort = () => controller.abort();
    signal?.addEventListener('abort', onAbort);
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await fetch(url, { ...init, signal: controller.signal });
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
    }
  }
}

function stripJsonFence(raw: string): string {
  const trimmed = raw.trim();
  const m = trimmed.match(/^```(?:json)?\s*([\s\S]*?)```$/i);
  return m ? m[1]!.trim() : trimmed;
}

function isAbort(err: unknown): boolean {
  return (
    (err instanceof Error && err.name === 'AbortError') ||
    (typeof err === 'object' &&
      err !== null &&
      'name' in err &&
      (err as { name: string }).name === 'AbortError')
  );
}

function isTimeout(err: unknown): boolean {
  return isAbort(err); // fetch aborts on our timeout controller
}

export function createLocalHttpModelPorts(
  opts: LocalHttpModelClientOptions
): ModelPorts {
  return new LocalHttpModelClient(opts);
}
