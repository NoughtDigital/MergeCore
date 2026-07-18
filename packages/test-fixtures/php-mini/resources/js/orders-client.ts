/** TypeScript client that calls the PHP API routes (cross-language evidence). */
export async function refundOrder(orderId: number): Promise<void> {
  await fetch(`/orders/${orderId}/refund`, { method: 'POST' });
}

export async function createOrder(total: number): Promise<Response> {
  return fetch('/orders', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ total, status: 'paid' }),
  });
}
