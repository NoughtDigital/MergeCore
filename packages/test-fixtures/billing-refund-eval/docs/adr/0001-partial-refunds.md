# ADR 0001: Partial subscription refunds

## Status

Accepted

## Context

Customers need partial refunds on subscription charges without cancelling the plan.

## Decision

Route refunds through billing/refunds → gateway → webhooks.
