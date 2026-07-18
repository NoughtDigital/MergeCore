import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createPartialRefund, calculateRefundableAmount } from '../src/billing/refunds';
import { processPartialSubscriptionRefund } from '../src/billing/subscriptions';

describe('partial subscription refunds', () => {
  it('creates partial refund', () => {
    const r = createPartialRefund('sub_1', { amount: 500, currency: 'gbp' });
    assert.equal(r.kind, 'partial');
  });

  it('processes refund via subscription flow', async () => {
    const result = await processPartialSubscriptionRefund(
      'sub_1',
      'ch_1',
      { amount: 1000, currency: 'gbp' },
      { amount: 250, currency: 'gbp' }
    );
    assert.equal(result.status, 'refunded');
  });

  it('calculates refundable', () => {
    assert.equal(
      calculateRefundableAmount(
        { amount: 100, currency: 'gbp' },
        { amount: 40, currency: 'gbp' }
      ).amount,
      60
    );
  });
});
