export type Money = { amount: number; currency: string };

export interface Subscription {
  id: string;
  status: 'active' | 'cancelled' | 'past_due';
}

/** Create a partial subscription refund request. */
export function createPartialRefund(
  subscriptionId: string,
  amount: Money
): { subscriptionId: string; amount: Money; kind: 'partial' } {
  return { subscriptionId, amount, kind: 'partial' };
}

export function calculateRefundableAmount(paid: Money, alreadyRefunded: Money): Money {
  return {
    amount: Math.max(0, paid.amount - alreadyRefunded.amount),
    currency: paid.currency,
  };
}
