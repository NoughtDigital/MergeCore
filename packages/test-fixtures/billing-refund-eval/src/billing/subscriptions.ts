import { submitGatewayRefund } from './gateway';
import { calculateRefundableAmount, createPartialRefund } from './refunds';
import type { Money } from './refunds';

export async function processPartialSubscriptionRefund(
  subscriptionId: string,
  chargeId: string,
  paid: Money,
  refund: Money
): Promise<{ status: string }> {
  const refundable = calculateRefundableAmount(paid, { amount: 0, currency: paid.currency });
  const req = createPartialRefund(subscriptionId, {
    amount: Math.min(refund.amount, refundable.amount),
    currency: paid.currency,
  });
  await submitGatewayRefund(chargeId, req.amount);
  return { status: 'refunded' };
}
