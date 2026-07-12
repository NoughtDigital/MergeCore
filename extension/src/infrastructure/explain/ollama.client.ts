import type { EmbeddingPort } from '@mergecore/intelligence';

export interface OllamaChatMessage {
  readonly role: 'system' | 'user' | 'assistant';
  readonly content: string;
}

export interface OllamaClientOptions {
  readonly baseUrl: string;
  readonly chatModel: string;
  readonly embedModel: string;
  readonly timeoutMs?: number;
  /** How long a successful/failed availability probe is cached. Default 45s. */
  readonly availabilityTtlMs?: number;
}

/**
 * Minimal Ollama HTTP client for local embeddings and chat.
 * All calls stay on the configured local base URL (default localhost).
 */
export class OllamaClient implements EmbeddingPort {
  private availabilityCache:
    | { readonly ok: boolean; readonly checkedAt: number }
    | undefined;

  constructor(private readonly opts: OllamaClientOptions) {}

  get chatModel(): string {
    return this.opts.chatModel;
  }

  get embedModel(): string {
    return this.opts.embedModel;
  }

  async isAvailable(signal?: AbortSignal): Promise<boolean> {
    const ttl = this.opts.availabilityTtlMs ?? 45_000;
    const cached = this.availabilityCache;
    if (cached && Date.now() - cached.checkedAt < ttl) {
      return cached.ok;
    }
    try {
      const res = await this.fetch('/api/tags', { method: 'GET' }, signal);
      const ok = res.ok;
      this.availabilityCache = { ok, checkedAt: Date.now() };
      return ok;
    } catch {
      this.availabilityCache = { ok: false, checkedAt: Date.now() };
      return false;
    }
  }

  async embed(
    texts: readonly string[],
    signal?: AbortSignal
  ): Promise<readonly (readonly number[])[] | undefined> {
    if (texts.length === 0) {
      return [];
    }
    try {
      const out: number[][] = [];
      for (const text of texts) {
        if (signal?.aborted) {
          return undefined;
        }
        const res = await this.fetch(
          '/api/embeddings',
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ model: this.opts.embedModel, prompt: text }),
          },
          signal
        );
        if (!res.ok) {
          return undefined;
        }
        const json = (await res.json()) as { embedding?: number[] };
        if (!Array.isArray(json.embedding)) {
          return undefined;
        }
        out.push(json.embedding);
      }
      return out;
    } catch {
      return undefined;
    }
  }

  async chat(
    messages: readonly OllamaChatMessage[],
    signal?: AbortSignal
  ): Promise<string | undefined> {
    try {
      const res = await this.fetch(
        '/api/chat',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: this.opts.chatModel,
            stream: false,
            messages,
          }),
        },
        signal
      );
      if (!res.ok) {
        return undefined;
      }
      const json = (await res.json()) as { message?: { content?: string } };
      const content = json.message?.content?.trim();
      return content && content.length > 0 ? content : undefined;
    } catch {
      return undefined;
    }
  }

  private async fetch(
    pathname: string,
    init: RequestInit,
    externalSignal?: AbortSignal
  ): Promise<Response> {
    const base = this.opts.baseUrl.replace(/\/$/, '');
    const timeoutMs = this.opts.timeoutMs ?? 45_000;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const onAbort = (): void => controller.abort();
    if (externalSignal) {
      if (externalSignal.aborted) {
        clearTimeout(timer);
        throw new DOMException('Aborted', 'AbortError');
      }
      externalSignal.addEventListener('abort', onAbort, { once: true });
    }
    try {
      return await fetch(`${base}${pathname}`, { ...init, signal: controller.signal });
    } finally {
      clearTimeout(timer);
      externalSignal?.removeEventListener('abort', onAbort);
    }
  }
}
