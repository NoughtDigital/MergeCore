import type { Money } from './refunds';
import { createPartialRefund } from './refunds';

export interface GatewayCharge {
  id: string;
  amount: Money;
}

/** Submit a refund to the payment gateway. */
export async function submitGatewayRefund(
  chargeId: string,
  amount: Money
): Promise<{ ok: boolean; chargeId: string }> {
  void createPartialRefund(chargeId, amount);
  return { ok: true, chargeId };
}

export function mapGatewayError(code: string): string {
  return `gateway:${code}`;
}
