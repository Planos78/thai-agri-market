# Developer: Phase 5 fix — BUG-A (payout dead) + BUG-B (over-refund double-pay)

Date: 2026-06-27 | Role: Developer | Stakes: durable, MONEY-CRITICAL | Branch: main | apps/web
Scope: surgical fix of the two QA bugs only. No schema change, no migration. No .env touched. Not committed.

## BUG-A (functional, high): transferAmount never set on the happy path -> payout dead

Root cause: `transferAmount` (Order, `Decimal?`, no default) was set ONLY by `fulfillment-tx.ts`
(adjustment-decide recompute + reschedule-reject cancel). `order-create.ts` and the payment-success
callback never set it, so a normally-paid LIFF/SHOP order had `transferAmount = null` ->
`isPayoutEligibleAmount(0) = false` -> 422 "transferAmount not > 0". The integration test masked
it by hand-seeding `transferAmount: 2009.25`.

Fix: compute + persist `transferAmount` when the order flips to PAID, inside the existing
`$transaction` in the payment-success branch of `interface/payment/callback` (handleOrder).
Uses the SAME fn as adjustments for consistency (OBS-1 clamp):
`transferAmount = calcTransferAmount(totalAmount, feeAmount, vatFeeAmount, refundedAmount)`.
At paid time `refundedAmount` is the already-settled sum (normally 0).

Worked number (durian 10@180 + mango 5@90, take 0.10 / vat 0.07):
`2250 - 225 - 15.75 - 0 = 2009.25`. After normal order -> mock-pay -> PAID, the order now has
`transferAmount = 2009.25` and is payout-eligible (verified live: payout batch create DRAFT
total 2009.25 -> submit -> callback SUCCEEDED -> escrow RELEASED).

Increase-payment path: unchanged and still correct. `handleIncreasePay` only flips IncreasePayment
to SUCCEEDED; the order's `transferAmount` was already recomputed at `decideAdjustment` (INCREASE
branch) when the adjustment was approved. No double-set.

## BUG-B (MONEY-CRITICAL double-pay): over-refund via concurrent in-flight refunds

Root cause: the over-refund invariant counted only `order.refundedAmount` (sum of SUCCEEDED refunds),
not PENDING in-flight ones, and the read-check-create was not serialized. Two overlapping FULL
refunds could both be created (201), approved, settled -> a 2250 order refunded 4320 (TOCTOU).

Fix (two parts, both in `createRefund` inside the existing `$transaction`):
1. Invariant now counts ALL non-terminal-failed refunds. Added a `tx.refund.aggregate(_sum.amount)`
   over `status IN (PENDING, SUCCEEDED)` = `committedOrInFlight`, sourced from the Refund table
   (authoritative), not the denormalized `order.refundedAmount`. `isRefundWithinLimit` param renamed
   `refundedAmount -> committedOrInFlight`. FULL amount is now `total - committedOrInFlight` (so a
   second FULL while one is PENDING computes 0 -> rejected 422).
2. TOCTOU closed with a row lock: `SELECT "id" FROM "Order" WHERE "id" = $orderId FOR UPDATE` via
   `tx.$queryRaw` at the top of the create tx (mirrors order-no.ts FOR UPDATE pattern). Concurrent
   refund creates serialize on the same Order row; only one passes the check.

Approve/settle: no change needed. The create gate now enforces the invariant across all non-failed
refunds, so the sum can never exceed total; `applyRefundCallback` already runs in `$transaction` with
a per-refund `canSettleRefund` guard (no double-settle of one refund).

Re-verified live with the QA repro: two overlapping FULL refunds on one paid order ->
only ONE reaches a non-failed state (second rejected 422); concurrent Promise.all variant ->
exactly one created; sum of non-failed refunds <= amountPaid in both cases.

## Files changed
- `src/app/api/interface/payment/callback/route.ts` — import calcTransferAmount; set transferAmount
  in the PAID branch inside the tx (BUG-A).
- `src/lib/settlement.ts` — `isRefundWithinLimit` param `refundedAmount -> committedOrInFlight`
  (+ comment) (BUG-B).
- `src/lib/settlement-tx.ts` — `createRefund`: FOR UPDATE row lock on Order, aggregate
  PENDING+SUCCEEDED refund sum, FULL = total - committedOrInFlight, pass committedOrInFlight to
  the invariant (BUG-B).
- `src/lib/__tests__/settlement.test.ts` — updated invariant test to new param; added BUG-B
  unit test (in-flight PENDING counts toward the limit). 14 tests.
- `src/lib/__tests__/settlement.integration.test.ts` — `seedPaidOrder` no longer hand-seeds
  transferAmount; drives the order through the REAL payment callback (unmasks BUG-A) and asserts
  `transferAmount = 2009.25` in the payout test; added 2 BUG-B integration tests (sequential overlap
  + concurrent Promise.all); over-refund test now seeds a real SUCCEEDED Refund row (authoritative
  source) instead of only the denormalized refundedAmount.

## Verify results
- `npx prisma generate`: skipped (schema unchanged — no migration).
- `npx tsc --noEmit`: exit 0, 0 errors.
- `npx vitest run` (DB-free): 78 passed / 34 skipped, exit 0.
- `LIVE_DB=1 npx vitest run` (full): 104 passed / 8 skipped, exit 0. settlement.integration 11/11
  (incl. both BUG-A and BUG-B), fulfillment.integration 12/12.
- `npx next build`: exit 0; all P5 routes registered.
- DB clean after run: 0 vitest-leaked orders/refunds, 0 total orders/refunds (suite self-cleans).

## Proof
- BUG-A: normal order -> mock-pay -> PAID yields transferAmount = total - fee - vat = 2009.25 (set by
  the payment path, not hand-seeded); order is now payout-eligible. Asserted live.
- BUG-B: on a 2250 paid order, FULL #1 = 2250 PENDING; FULL #2 rejected 422 (committedOrInFlight=2250);
  concurrent pair -> exactly one created. sum(non-failed refunds) <= 2250 always. Over-refund is now
  impossible: create-time invariant counts PENDING+SUCCEEDED under a FOR UPDATE row lock.
