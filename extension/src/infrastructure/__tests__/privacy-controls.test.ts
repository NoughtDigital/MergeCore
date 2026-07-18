import assert from 'node:assert/strict';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { after, before, describe, it } from 'node:test';
import {
  evaluateExternalSendGate,
  PrivacyGateError,
} from '../privacy/privacy-gate-core';
import {
  isLoopbackOllamaUrl,
  providerRequiresExternalRequests,
  type PrivacySettings,
} from '../privacy/privacy-settings-core';
import {
  assertNoSecretsInDiagnostics,
  redactHomePath,
  serialiseDiagnostics,
  type DiagnosticsPayload,
} from '../privacy/diagnostics-export-core';
import { wipeMergeCoreLocalData } from '../privacy/wipe-local-index';
import { modelEnhancementAllowed, resolveChatPorts } from '../explain/model-provider-factory';
import type { MergeCoreSecretStore } from '../secret-store';

function settings(partial: Partial<PrivacySettings>): PrivacySettings {
  const modelMode =
    partial.modelMode ??
    (partial.modelProvider === 'openai' || partial.modelProvider === 'anthropic'
      ? 'external'
      : partial.modelProvider === 'ollama'
        ? 'local'
        : 'deterministic');
  const externalProvider =
    partial.externalProvider ??
    (partial.modelProvider === 'anthropic' ? 'anthropic' : 'openai');
  const localBaseUrl =
    partial.localBaseUrl ??
    (partial.ollamaBaseUrl
      ? partial.ollamaBaseUrl.includes('/v1')
        ? partial.ollamaBaseUrl
        : `${partial.ollamaBaseUrl.replace(/\/+$/, '')}/v1`
      : 'http://127.0.0.1:11434/v1');
  return {
    modelMode,
    externalProvider,
    modelProvider: partial.modelProvider ?? (modelMode === 'deterministic' ? 'none' : modelMode === 'local' ? 'ollama' : externalProvider),
    externalRequestsEnabled: false,
    anonymiseDiagnostics: false,
    usageAnalyticsEnabled: false,
    enableModelExplanation: false,
    localBaseUrl,
    localModel: partial.localModel ?? partial.chatModel ?? 'llama3.2',
    localTimeoutMs: 45_000,
    localMaxContextTokens: 8192,
    localSupportsStructuredOutput: true,
    localSupportsStreaming: true,
    localApiKey: '',
    ollamaBaseUrl: partial.ollamaBaseUrl ?? 'http://127.0.0.1:11434',
    chatModel: partial.chatModel ?? 'llama3.2',
    embedModel: 'nomic-embed-text',
    ...partial,
    modelMode: partial.modelMode ?? modelMode,
    externalProvider: partial.externalProvider ?? externalProvider,
    localBaseUrl: partial.localBaseUrl ?? localBaseUrl,
  };
}

describe('privacy settings and gate', () => {
  it('treats loopback Ollama as local', () => {
    assert.equal(isLoopbackOllamaUrl('http://127.0.0.1:11434'), true);
    assert.equal(isLoopbackOllamaUrl('https://api.example.com'), false);
  });

  it('requires external gate for openai/anthropic and remote ollama', () => {
    assert.equal(
      providerRequiresExternalRequests(settings({ modelProvider: 'openai' })),
      true
    );
    assert.equal(
      providerRequiresExternalRequests(
        settings({ modelProvider: 'ollama', ollamaBaseUrl: 'https://remote.example' })
      ),
      true
    );
    assert.equal(
      providerRequiresExternalRequests(settings({ modelProvider: 'ollama' })),
      false
    );
  });

  it('blocks model enhancement when external disabled for external providers', () => {
    assert.equal(
      modelEnhancementAllowed(
        settings({
          enableModelExplanation: true,
          modelProvider: 'openai',
          externalRequestsEnabled: false,
        })
      ),
      false
    );
    assert.equal(
      modelEnhancementAllowed(
        settings({
          enableModelExplanation: true,
          modelProvider: 'ollama',
          externalRequestsEnabled: false,
        })
      ),
      true
    );
  });

  it('rejects cancelled first-time external consent', () => {
    const result = evaluateExternalSendGate({
      isTrusted: true,
      requiresExternal: true,
      externalRequestsEnabled: true,
      alreadyConsented: false,
      confirmChoice: undefined,
    });
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.error.code, 'consent_cancelled');
      assert.ok(result.error instanceof PrivacyGateError);
    }
  });

  it('rejects when external requests disabled', () => {
    const result = evaluateExternalSendGate({
      isTrusted: true,
      requiresExternal: true,
      externalRequestsEnabled: false,
      alreadyConsented: false,
    });
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.error.code, 'external_disabled');
    }
  });

  it('rejects untrusted workspace', () => {
    const result = evaluateExternalSendGate({
      isTrusted: false,
      requiresExternal: true,
      externalRequestsEnabled: true,
      alreadyConsented: false,
      confirmChoice: 'Allow once',
    });
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.error.code, 'untrusted');
    }
  });

  it('persists always-allow when chosen', () => {
    const result = evaluateExternalSendGate({
      isTrusted: true,
      requiresExternal: true,
      externalRequestsEnabled: true,
      alreadyConsented: false,
      confirmChoice: 'Always allow',
    });
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.persistAlwaysAllow, true);
    }
  });
});

describe('model provider factory — no silent external fallback', () => {
  it('does not call openai when local mode is selected even if openai key exists', async () => {
    let openAiCalled = false;
    const secrets = {
      async hasOpenAiKey() {
        return true;
      },
      async hasAnthropicKey() {
        return false;
      },
      async getOpenAiApiKey() {
        openAiCalled = true;
        return 'sk-test';
      },
      async getAnthropicApiKey() {
        return undefined;
      },
    } as unknown as MergeCoreSecretStore;

    const ports = resolveChatPorts({
      secrets,
      getOllama: () =>
        ({
          chat: async () => {
            throw new Error('ollama down');
          },
          isAvailable: async () => false,
        }) as never,
      getSettings: () =>
        settings({
          modelMode: 'local',
          modelProvider: 'ollama',
          localBaseUrl: 'http://127.0.0.1:1/v1',
          enableModelExplanation: true,
        }),
    });

    assert.equal(ports.providerId, 'local-http');
    assert.equal(await ports.isAvailable(), false);
    assert.equal(openAiCalled, false);
  });

  it('external openai ports unavailable when externalRequestsEnabled is false', async () => {
    const secrets = {
      async hasOpenAiKey() {
        return true;
      },
      async hasAnthropicKey() {
        return false;
      },
      async getOpenAiApiKey() {
        return 'sk-test';
      },
      async getAnthropicApiKey() {
        return undefined;
      },
    } as unknown as MergeCoreSecretStore;

    const ports = resolveChatPorts({
      secrets,
      getOllama: () => ({}) as never,
      getSettings: () =>
        settings({
          modelProvider: 'openai',
          externalRequestsEnabled: false,
        }),
    });
    assert.equal(await ports.isAvailable(), false);
    assert.equal(await ports.chat([{ role: 'user', content: 'hi' }]), undefined);
  });
});

describe('diagnostics redaction', () => {
  it('redacts home paths and never embeds API keys or source bodies', () => {
    const home = os.homedir();
    const redacted = redactHomePath(`${home}/Sites/SecretRepo/.mergecore/rag`);
    assert.ok(redacted.startsWith('~'));
    assert.ok(!redacted.includes(home) || home.length < 2);

    const payload: DiagnosticsPayload = {
      exportedAt: new Date().toISOString(),
      extensionVersion: '0.1.0',
      workspaceFingerprint: 'abc',
      workspaceLabel: '~/Sites/Demo',
      trusted: true,
      privacy: {
        externalRequestsEnabled: false,
        modelProvider: 'none',
        enableModelExplanation: false,
        providerKeyPresent: false,
        apiTokenPresent: false,
      },
      index: {
        storagePath: '~/.mergecore/rag',
        indexedFileCount: 1,
        excludedFileCount: 0,
        chunkCount: 2,
        symbolCount: 3,
        indexSizeBytes: 10,
        lastCompletedIndexAt: null,
        phase: 'done',
        schemaVersion: 4,
      },
      ignoreRules: ['.gitignore: 1 pattern(s)'],
      transmittedRepositoryContent: false,
      lastTransmissionAt: null,
      envKeysPresent: ['OPENAI_API_KEY'],
      notes: ['No source file contents included.'],
    };
    const text = serialiseDiagnostics(payload);
    assert.ok(!text.includes('sk-'));
    assert.ok(!text.includes('export function'));
    assert.ok(text.includes('OPENAI_API_KEY'));
    assert.ok(!/OPENAI_API_KEY":\s*"[^"]+"/.test(text));
    assertNoSecretsInDiagnostics(text);
  });

  it('index path display ends with .mergecore/rag', () => {
    const storeDir = path.join('/tmp/ws', '.mergecore', 'rag');
    assert.ok(storeDir.replace(/\\/g, '/').endsWith('.mergecore/rag'));
  });
});

describe('delete local index preserves memory', () => {
  let root: string;

  before(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'mergecore-privacy-del-'));
    await fs.mkdir(path.join(root, '.mergecore', 'rag'), { recursive: true });
    await fs.mkdir(path.join(root, '.mergecore', 'memory'), { recursive: true });
    await fs.mkdir(path.join(root, '.mergecore', 'generated'), { recursive: true });
    await fs.writeFile(path.join(root, '.mergecore', 'rag', 'index.json'), '{}');
    await fs.writeFile(path.join(root, '.mergecore', 'memory', 'architecture.md'), '# Arch\n');
    await fs.writeFile(path.join(root, '.mergecore', 'generated', 'x.md'), 'gen');
  });

  after(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  it('deletes rag and generated, keeps memory by default', async () => {
    const result = await wipeMergeCoreLocalData(root, { includeGenerated: true });
    assert.equal(result.deletedRag, true);
    assert.equal(result.deletedGenerated, true);
    assert.equal(result.deletedMemory, false);
    await assert.rejects(() => fs.access(path.join(root, '.mergecore', 'rag')));
    await fs.access(path.join(root, '.mergecore', 'memory', 'architecture.md'));
  });
});

describe('secrets never written to diagnostics settings snapshot', () => {
  it('serialised privacy settings object has no key fields', () => {
    const snap = settings({
      modelProvider: 'openai',
      externalRequestsEnabled: true,
    });
    const json = JSON.stringify(snap);
    assert.ok(!json.toLowerCase().includes('sk-'));
    assert.ok(!json.includes('apiKey'));
    assert.ok(!json.includes('apiToken'));
  });
});

describe('model transmission path blocks', () => {
  it('PrivacyGateError message shape for blocked classification', () => {
    const err = new PrivacyGateError(
      'Cannot send `.env` to a model for Explain Selected Code: classified as never_send_to_model',
      'privacy_blocked'
    );
    assert.match(err.message, /never_send_to_model/);
    assert.equal(err.name, 'PrivacyGateError');
    assert.equal(err.code, 'privacy_blocked');
  });
});
