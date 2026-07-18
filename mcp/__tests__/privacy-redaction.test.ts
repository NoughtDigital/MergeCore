import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import {
  filterPathsForModelEvidence,
  privacyDecisionForPath,
  redactExcerptForPrivacy,
} from '../src/security.js';

describe('MCP privacy redaction', () => {
  it('redacts excerpts for never_send_to_model', () => {
    const redacted = redactExcerptForPrivacy('SECRET_VALUE', 'never_send_to_model');
    assert.ok(redacted);
    assert.ok(!redacted!.includes('SECRET_VALUE'));
    assert.match(redacted!, /omitted/);
  });

  it('leaves normal excerpts intact', () => {
    assert.equal(redactExcerptForPrivacy('hello', 'normal'), 'hello');
  });

  it('filterPathsForModelEvidence drops never_send paths', async () => {
    const root = await mkdtemp(join(tmpdir(), 'mc-mcp-priv-'));
    try {
      await mkdir(join(root, 'src'), { recursive: true });
      await writeFile(join(root, 'src', 'ok.ts'), 'export const ok = 1;\n');
      await writeFile(join(root, '.env'), 'X=1\n');
      const allowed = await filterPathsForModelEvidence(root, ['.env', 'src/ok.ts']);
      assert.deepEqual(allowed, ['src/ok.ts']);
      const decision = await privacyDecisionForPath(root, '.env');
      assert.equal(decision.classification, 'never_send_to_model');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
