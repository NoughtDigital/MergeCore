# Refunds

When implementing partial subscription refunds, call `createPartialRefund` then
the gateway submit helper. Webhooks must update refund state.

Always cover refund flows with tests under `tests/`.
