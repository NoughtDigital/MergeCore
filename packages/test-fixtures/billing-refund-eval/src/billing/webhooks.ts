import { processPartialSubscriptionRefund } from './subscriptions';

/** Handle Stripe (or similar) webhook events for refunds. */
export async function handleRefundWebhook(payload: {
  type: string;
  subscriptionId: string;
  chargeId: string;
  amount: number;
  currency: string;
}): Promise<void> {
  if (payload.type !== 'charge.refund.updated') {
    return;
  }
  await processPartialSubscriptionRefund(
    payload.subscriptionId,
    payload.chargeId,
    { amount: payload.amount, currency: payload.currency },
    { amount: payload.amount, currency: payload.currency }
  );
}
