import type { OllamaChatMessage } from './ollama.client';
import type { MergeCoreSecretStore } from '../secret-store';

export interface ChatPorts {
  readonly chat: (
    messages: readonly OllamaChatMessage[],
    signal?: AbortSignal
  ) => Promise<string | undefined>;
  readonly isAvailable: (signal?: AbortSignal) => Promise<boolean>;
  readonly providerId: string;
}

async function postJson(
  url: string,
  headers: Record<string, string>,
  body: unknown,
  signal?: AbortSignal
): Promise<Response> {
  return fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
    signal,
  });
}

function toOpenAiMessages(messages: readonly OllamaChatMessage[]): Array<{
  role: string;
  content: string;
}> {
  return messages.map((m) => ({ role: m.role, content: m.content }));
}

/**
 * OpenAI Chat Completions — BYOK via SecretStorage. Never logs the key.
 */
export function createOpenAiChatPorts(
  secrets: MergeCoreSecretStore,
  model = 'gpt-4o-mini'
): ChatPorts {
  return {
    providerId: 'openai',
    async isAvailable(signal) {
      const key = await secrets.getOpenAiApiKey();
      if (!key) return false;
      void signal;
      return true;
    },
    async chat(messages, signal) {
      const key = await secrets.getOpenAiApiKey();
      if (!key) return undefined;
      try {
        const res = await postJson(
          'https://api.openai.com/v1/chat/completions',
          { Authorization: `Bearer ${key}` },
          {
            model,
            messages: toOpenAiMessages(messages),
            temperature: 0.2,
          },
          signal
        );
        if (!res.ok) return undefined;
        const json = (await res.json()) as {
          choices?: Array<{ message?: { content?: string } }>;
        };
        return json.choices?.[0]?.message?.content?.trim() || undefined;
      } catch {
        return undefined;
      }
    },
  };
}

/**
 * Anthropic Messages API — BYOK via SecretStorage. Never logs the key.
 */
export function createAnthropicChatPorts(
  secrets: MergeCoreSecretStore,
  model = 'claude-3-5-haiku-latest'
): ChatPorts {
  return {
    providerId: 'anthropic',
    async isAvailable(signal) {
      const key = await secrets.getAnthropicApiKey();
      if (!key) return false;
      void signal;
      return true;
    },
    async chat(messages, signal) {
      const key = await secrets.getAnthropicApiKey();
      if (!key) return undefined;
      const system = messages
        .filter((m) => m.role === 'system')
        .map((m) => m.content)
        .join('\n');
      const userAssistant = messages
        .filter((m) => m.role !== 'system')
        .map((m) => ({
          role: m.role === 'assistant' ? 'assistant' : 'user',
          content: m.content,
        }));
      try {
        const res = await postJson(
          'https://api.anthropic.com/v1/messages',
          {
            'x-api-key': key,
            'anthropic-version': '2023-06-01',
          },
          {
            model,
            max_tokens: 2048,
            system: system || undefined,
            messages: userAssistant,
          },
          signal
        );
        if (!res.ok) return undefined;
        const json = (await res.json()) as {
          content?: Array<{ type?: string; text?: string }>;
        };
        const text = json.content?.find((c) => c.type === 'text')?.text;
        return text?.trim() || undefined;
      } catch {
        return undefined;
      }
    },
  };
}

export const unavailableChatPorts: ChatPorts = {
  providerId: 'none',
  async isAvailable() {
    return false;
  },
  async chat() {
    return undefined;
  },
};
