import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  assignEvidenceIds,
  createSourceReference,
  validateModelClaimBundle,
} from '@mergecore/intelligence';
import {
  validateAndStripCitations,
  validateModelClaimsAgainstEvidence,
} from '../../presentation/explain/citation-validate';

describe('model evidence ID validation', () => {
  it('rejects claims with invalid evidence IDs', () => {
    const refs = assignEvidenceIds([
      createSourceReference({
        workspaceId: 'ws',
        path: 'src/a.ts',
        startLine: 1,
        endLine: 2,
        sourceType: 'source',
        sourceFingerprint: 'x',
      }),
    ]);
    const map = new Map(refs.map((r) => [r.evidenceId!, r]));
    const result = validateModelClaimBundle(
      {
        claims: [
          { text: 'ok', evidenceIds: ['evidence-1'] },
          { text: 'bad', evidenceIds: ['evidence-999'] },
        ],
      },
      map
    );
    assert.equal(result.accepted.length, 1);
    assert.equal(result.rejected.length, 1);
  });

  it('validateModelClaimsAgainstEvidence keeps only supported claims', () => {
    const refs = assignEvidenceIds([
      createSourceReference({
        workspaceId: 'ws',
        path: 'src/billing/refunds.ts',
        startLine: 12,
        endLine: 18,
        sourceType: 'symbol',
        sourceFingerprint: 'fp',
      }),
    ]);
    const raw = JSON.stringify({
      claims: [
        {
          text: 'Refund requests are queued before provider processing.',
          evidenceIds: ['evidence-1'],
          certainty: 'high',
        },
        {
          text: 'Invented behaviour',
          evidenceIds: ['evidence-99'],
          certainty: 'high',
        },
      ],
    });
    const validated = validateModelClaimsAgainstEvidence(raw, refs);
    assert.ok(
      validated.acceptedClaimTexts?.includes(
        'Refund requests are queued before provider processing.'
      )
    );
    assert.equal(validated.rejectedClaimCount, 1);
    assert.ok(!validated.markdown.includes('Invented behaviour'));
  });

  it('strips unknown path citations in legacy mode', () => {
    const result = validateAndStripCitations('See `evil.ts:1` and `src/ok.ts:2`', [
      { path: 'src/ok.ts', startLine: 1, endLine: 10 },
    ]);
    assert.ok(result.discardedCitations.length >= 1);
    assert.ok(result.markdown.includes('citation removed'));
  });
});
