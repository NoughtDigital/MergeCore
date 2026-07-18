import assert from 'node:assert/strict';
import * as http from 'node:http';
import { after, before, describe, it } from 'node:test';
import {
  assignEvidenceIds,
  createSourceReference,
  validateModelClaimBundle,
  evidenceMapById,
  parseModelClaimsJson,
} from '@mergecore/intelligence';
import { LocalHttpModelClient } from '../explain/local-http-model.client';
import { ModelClientError } from '../explain/model-ports';
import { enhanceWithValidatedClaims } from '../explain/enhance-with-validated-claims';
import { resolveModelPorts } from '../explain/model-provider-factory';
import type { PrivacySettings } from '../privacy/privacy-settings-core';
import type { MergeCoreSecretStore } from '../secret-store';

function baseSettings(partial: Partial<PrivacySettings> = {}): PrivacySettings {
  return {
    modelMode: 'local',
    externalProvider: 'openai',
    modelProvider: 'ollama',
    externalRequestsEnabled: false,
    anonymiseDiagnostics: false,
    usageAnalyticsEnabled: false,
    enableModelExplanation: true,
    localBaseUrl: 'http://127.0.0.1:9/v1',
    localModel: 'test-model',
    localTimeoutMs: 5_000,
    localMaxContextTokens: 2048,
    localSupportsStructuredOutput: true,
    localSupportsStreaming: true,
    localApiKey: '',
    ollamaBaseUrl: 'http://127.0.0.1:9',
    chatModel: 'test-model',
    embedModel: 'nomic-embed-text',
    ...partial,
  };
}

describe('LocalHttpModelClient (mock server)', () => {
  let server: http.Server;
  let baseUrl: string;
  let lastAuth: string | undefined;
  let behaviour:
    | 'ok'
    | 'down'
    | 'missing_model'
    | 'slow'
    | 'bad_json'
    | 'stream'
    | 'stream_abort';

  before(async () => {
    behaviour = 'ok';
    server = http.createServer((req, res) => {
      lastAuth = req.headers.authorization;
      if (behaviour === 'down') {
        res.destroy();
        return;
      }
      if (req.url?.endsWith('/models') || req.url === '/v1/models') {
        if (behaviour === 'missing_model') {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ data: [{ id: 'other-model' }] }));
          return;
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ data: [{ id: 'test-model' }] }));
        return;
      }
      if (req.url?.includes('/chat/completions')) {
        if (behaviour === 'slow') {
          // Hold the connection open until the client aborts (do not respond).
          req.on('close', () => {
            try {
              res.end();
            } catch {
              // ignore
            }
          });
          return;
        }
        if (behaviour === 'bad_json') {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(
            JSON.stringify({
              choices: [{ message: { content: 'not-json-claims' } }],
            })
          );
          return;
        }
        if (behaviour === 'stream' || behaviour === 'stream_abort') {
          res.writeHead(200, {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            Connection: 'keep-alive',
          });
          res.write(
            `data: ${JSON.stringify({ choices: [{ delta: { content: '{"claims":[' } }] })}\n\n`
          );
          if (behaviour === 'stream_abort') {
            res.destroy();
            return;
          }
          res.write(
            `data: ${JSON.stringify({
              choices: [
                {
                  delta: {
                    content:
                      '{"text":"Auth checks the session cookie.","evidenceIds":["evidence-1"],"certainty":"medium"}]',
                  },
                },
              ],
            })}\n\n`
          );
          res.write(
            `data: ${JSON.stringify({ choices: [{ delta: { content: ']}' } }] })}\n\n`
          );
          res.write('data: [DONE]\n\n');
          res.end();
          return;
        }
        let body = '';
        req.on('data', (c) => {
          body += c;
        });
        req.on('end', () => {
          const parsed = JSON.parse(body || '{}') as {
            messages?: Array<{ content?: string }>;
            response_format?: { type?: string };
          };
          void parsed;
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(
            JSON.stringify({
              choices: [
                {
                  message: {
                    content: JSON.stringify({
                      claims: [
                        {
                          text: 'Auth checks the session cookie.',
                          evidenceIds: ['evidence-1'],
                          certainty: 'medium',
                        },
                        {
                          text: 'Invented claim without evidence.',
                          evidenceIds: ['evidence-999'],
                          certainty: 'high',
                        },
                      ],
                    }),
                  },
                },
              ],
            })
          );
        });
        return;
      }
      res.writeHead(404);
      res.end();
    });
    await new Promise<void>((resolve) => {
      server.listen(0, '127.0.0.1', () => resolve());
    });
    const addr = server.address();
    if (!addr || typeof addr === 'string') throw new Error('no addr');
    baseUrl = `http://127.0.0.1:${addr.port}/v1`;
  });

  after(async () => {
    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
  });

  it('health ok and lists models', async () => {
    behaviour = 'ok';
    const client = new LocalHttpModelClient({
      baseUrl,
      model: 'test-model',
      availabilityTtlMs: 0,
    });
    const health = await client.health();
    assert.equal(health.ok, true);
    assert.ok(health.models?.includes('test-model'));
  });

  it('reports model_missing', async () => {
    behaviour = 'missing_model';
    const client = new LocalHttpModelClient({
      baseUrl,
      model: 'test-model',
      availabilityTtlMs: 0,
    });
    const health = await client.health();
    assert.equal(health.ok, false);
    assert.equal(health.reason, 'model_missing');
  });

  it('reports server_unavailable when connection fails', async () => {
    const client = new LocalHttpModelClient({
      baseUrl: 'http://127.0.0.1:1/v1',
      model: 'test-model',
      timeoutMs: 500,
      availabilityTtlMs: 0,
    });
    const health = await client.health();
    assert.equal(health.ok, false);
    assert.equal(health.reason, 'server_unavailable');
  });

  it('completes JSON and validates evidence IDs (accept/reject)', async () => {
    behaviour = 'ok';
    const client = new LocalHttpModelClient({
      baseUrl,
      model: 'test-model',
      availabilityTtlMs: 0,
    });
    const evidence = assignEvidenceIds([
      createSourceReference({
        workspaceId: 'workspace',
        path: 'src/auth.ts',
        startLine: 1,
        endLine: 10,
        sourceType: 'source',
      }),
    ]);
    const result = await enhanceWithValidatedClaims({
      ports: client,
      evidence,
      userPrompt: 'Summarise auth.',
      purpose: 'test',
    });
    assert.equal(result.ok, true);
    assert.equal(result.acceptedClaimTexts.length, 1);
    assert.equal(result.rejectedCount, 1);
    assert.match(result.acceptedClaimTexts[0]!, /session cookie/i);
  });

  it('fails preflight when context too large', async () => {
    behaviour = 'ok';
    const client = new LocalHttpModelClient({
      baseUrl,
      model: 'test-model',
      maxContextTokens: 10,
      availabilityTtlMs: 0,
    });
    await assert.rejects(
      () =>
        client.complete({
          messages: [{ role: 'user', content: 'x'.repeat(200) }],
          estimatedInputTokens: 500,
        }),
      (err: unknown) =>
        err instanceof ModelClientError && err.kind === 'context_too_large'
    );
  });

  it('treats malformed JSON expectJson as malformed_json', async () => {
    behaviour = 'bad_json';
    const client = new LocalHttpModelClient({
      baseUrl,
      model: 'test-model',
      availabilityTtlMs: 0,
    });
    await assert.rejects(
      () =>
        client.complete({
          messages: [{ role: 'user', content: 'hi' }],
          expectJson: true,
        }),
      (err: unknown) =>
        err instanceof ModelClientError && err.kind === 'malformed_json'
    );
  });

  it('cancels in-flight complete via AbortSignal', async () => {
    behaviour = 'slow';
    const client = new LocalHttpModelClient({
      baseUrl,
      model: 'test-model',
      timeoutMs: 2_000,
      availabilityTtlMs: 0,
    });
    const ac = new AbortController();
    const pending = client.complete(
      { messages: [{ role: 'user', content: 'hi' }] },
      ac.signal
    );
    setTimeout(() => ac.abort(), 30);
    await assert.rejects(
      () => pending,
      (err: unknown) =>
        err instanceof ModelClientError &&
        (err.kind === 'cancelled' || err.kind === 'timeout')
    );
    behaviour = 'ok';
  });

  it('streams chunks then completes', async () => {
    behaviour = 'stream';
    const client = new LocalHttpModelClient({
      baseUrl,
      model: 'test-model',
      supportsStreaming: true,
      availabilityTtlMs: 0,
    });
    let text = '';
    for await (const ev of client.completeStream!({
      messages: [{ role: 'user', content: 'hi' }],
    })) {
      if (ev.error) throw ev.error;
      if (ev.delta) text += ev.delta;
    }
    assert.match(text, /claims/);
  });

  it('reports partial_stream_failure on mid-stream abort', async () => {
    behaviour = 'stream_abort';
    const client = new LocalHttpModelClient({
      baseUrl,
      model: 'test-model',
      supportsStreaming: true,
      availabilityTtlMs: 0,
    });
    let sawError = false;
    for await (const ev of client.completeStream!({
      messages: [{ role: 'user', content: 'hi' }],
    })) {
      if (ev.error) {
        sawError = true;
        assert.ok(
          ev.error.kind === 'partial_stream_failure' ||
            ev.error.kind === 'server_unavailable' ||
            ev.error.kind === 'cancelled'
        );
      }
    }
    assert.equal(sawError, true);
  });

  it('omits Authorization when no API key configured', async () => {
    behaviour = 'ok';
    lastAuth = undefined;
    const client = new LocalHttpModelClient({
      baseUrl,
      model: 'test-model',
      availabilityTtlMs: 0,
    });
    await client.complete({ messages: [{ role: 'user', content: 'hi' }] });
    assert.equal(lastAuth, undefined);
  });

  it('does not silently switch to external when local fails', async () => {
    let openaiCalled = false;
    const secrets = {
      async hasOpenAiKey() {
        return true;
      },
      async hasAnthropicKey() {
        return false;
      },
      async getOpenAiApiKey() {
        openaiCalled = true;
        return 'sk-test';
      },
      async getAnthropicApiKey() {
        return undefined;
      },
    } as unknown as MergeCoreSecretStore;

    const ports = resolveModelPorts({
      secrets,
      getOllama: () =>
        ({
          chat: async () => {
            throw new Error('should not use ollama native');
          },
          isAvailable: async () => false,
        }) as never,
      getSettings: () =>
        baseSettings({
          modelMode: 'local',
          localBaseUrl: 'http://127.0.0.1:1/v1',
          localTimeoutMs: 300,
        }),
    });

    assert.equal(ports.mode, 'local');
    const health = await ports.health();
    assert.equal(health.ok, false);
    assert.equal(openaiCalled, false);
    const chat = await ports.chat([{ role: 'user', content: 'x' }]);
    assert.equal(chat, undefined);
    assert.equal(openaiCalled, false);
  });

  it('parse + validate rejects unknown evidence ids', () => {
    const evidence = assignEvidenceIds([
      createSourceReference({
        workspaceId: 'workspace',
        path: 'a.ts',
        startLine: 1,
        endLine: 2,
        sourceType: 'source',
      }),
    ]);
    const bundle = parseModelClaimsJson(
      JSON.stringify({
        claims: [
          { text: 'ok', evidenceIds: ['evidence-1'], certainty: 'low' },
          { text: 'bad', evidenceIds: ['evidence-99'], certainty: 'high' },
        ],
      })
    );
    assert.ok(bundle);
    const validated = validateModelClaimBundle(bundle!, evidenceMapById(evidence));
    assert.equal(validated.accepted.length, 1);
    assert.equal(validated.rejected.length, 1);
  });
});
