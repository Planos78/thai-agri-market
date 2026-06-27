# QA Re-verify: Phase 5 money fixes — BUG-A (payout dead) + BUG-B (over-refund double-pay)

Date: 2026-06-27 | Role: QA (independent, adversarial, scoped) | Stakes: durable, MONEY-CRITICAL
Branch: main | apps/web | P5 build + fix on disk, uncommitted
Method: re-ran all gates; drove the LIVE dev server (port 3200, PSP_PROVIDER=mock) with real
curl/fetch + real HMAC signing + real admin JWT; inspected actual DB rows + money numbers via
Prisma. Trusted nothing from the done docs. Read the fixed source first. No code changed by QA.

## VERDICT: ship
Both fixes verified end-to-end with real numbers. The two original repros are gone. No regression
found. DB swept back to seed-only baseline; dev server killed; port-3000 app untouched.

---

## Gates (re-run, real output)
| Gate | Command | Result |
|---|---|---|
| Typecheck | `npx tsc --noEmit` | exit 0, 0 errors |
| Unit (DB-free) | `npx vitest run` | 78 passed / 34 skipped (13 files) exit 0; settlement.test 14 (incl BUG-B unit) |
| Build | `npx next build` | exit 0; all P5 routes registered (payout/refund callbacks, admin payout-batches/refunds/platform-config, shop checkout) |
| Integration (LIVE_DB) | `set -a && . ./.env && set +a && LIVE_DB=1 npx vitest run` | 104 passed / 8 skipped (16 files) exit 0. settlement.integration 11/11 (incl BUG-A transferAmount assert + BUG-B sequential & concurrent); fulfillment.integration 12/12 |

PSP_PROVIDER=mock confirmed live (Gate 0). DB host = Supabase pooler (aws-1-ap-northeast-1).

---

## BUG-A re-verify (happy-path payout) — PASS
Drove a NORMAL LIFF order (mock-buyer-1) of 10 durian @180 + 5 mango @90 through the REAL
payment callback, then the full payout chain, inspecting DB rows at each step.

- Order math: subTotal 2250, total 2250, fee **225** (= 2250 x 0.10), vatFee **15.75** (= 225 x 0.07).
- BEFORE pay: `transferAmount = null` (the original bug state).
- AFTER mock-pay (good HMAC, respCode 2000): `transferAmount = 2009.25` (= 2250 - 225 - 15.75 - 0).
  EXPECTED 2009.25 == GOT 2009.25, MATCH=true. Order PAID, payment COMPLETED + escrow HELD.
- Payout eligibility: `POST /api/admin/payout-batches {orderIds:[paidOrder]}` -> **201** (was 422
  "transferAmount not > 0"). `ineligible: []`. Batch DRAFT PB260627014, totalAmount **2009.25**,
  PayoutBatchOrder.amount **2009.25** (snapshot).
- Submit -> SUBMITTED + pspBatchRef MOCK-PB-PB260627014.
- Payout callback (good HMAC) -> batch **SUCCEEDED** (settledAt set), escrow HELD->**RELEASED**,
  **PayoutResponse** written with FK `payoutBatchId` populated + `accepted=true`.

The happy path "buyer pays -> orchard payout" now works end-to-end. Fix is in
`interface/payment/callback/route.ts` (PAID branch sets `transferAmount = calcTransferAmount(...)`
inside the existing tx; same fn as adjustments, OBS-1 clamp consistent).

## BUG-B re-verify (over-refund impossible) — PASS
Each sub-test on a fresh REAL paid 2250 order. Verified `sum(non-failed refunds) <= amountPaid`
with real numbers in every case. Invariant proven to count PENDING + SUCCEEDED.

- TEST 1 sequential: FULL #1 -> 201, amount 2250, status PENDING. FULL #2 -> **422**
  "refund exceeds order total (over-refund)" (in-flight PENDING counts). DB: 1 PENDING refund,
  nonFailedSum = 2250 <= 2250.
- TEST 2 concurrent (Promise.all of TWO separate HTTP requests): exactly **one 201, one 422**.
  DB: 1 PENDING refund, nonFailedSum = 2250 <= 2250.
- TEST 3 SUCCEEDED also blocks: FULL #1 approve -> good-HMAC settle -> SUCCEEDED;
  order.refundedAmount = 2250, payment REFUNDED + escrow REFUNDED. A 2nd FULL afterward -> **422**.
  nonFailedSum = 2250 <= 2250.
- STRESS (harder than asked): **5 simultaneous** FULL refunds on one paid order ->
  exactly **1x 201, 4x 422**, zero 500s/other. DB: 1 PENDING refund, nonFailedSum = 2250 <= 2250.

The original repro (4320 refunded on a 2250 order) is **impossible**: createRefund takes a
`SELECT ... FOR UPDATE` row lock on the Order, aggregates refunds with `status IN (PENDING,
SUCCEEDED)`, computes FULL = total - committedOrInFlight, and rejects via `isRefundWithinLimit`
inside the tx. Concurrent creates serialize on the order row; only one passes.

## Regression smoke (P1-P4 + rest of P5) — green
- 104/104 LIVE integration pass covers P1-P4 + rest of P5 (orders, fulfillment reschedule/adjust/
  delivery/proof/review, webhook HMAC, RBAC, web checkout SHOP == LIFF money, bad-HMAC -> 401).
- Take-rate from PlatformConfig (live): active cfg 0.10/0.07; on the paid order fee 225 = sub x 0.10,
  vat 15.75 = fee x 0.07 (round2), transfer 2009.25 = total - fee - vat. Not hardcoded.
- OBS-1 transfer clamp: transfer math correct live; clamp-to-0 (no negative) asserted in money.test
  (green) and settlement PARTIAL/over-refund integration (green LIVE).
- order -> mock-pay -> PAID: PAID + payment COMPLETED + escrow HELD confirmed live (BUG-A flow).
- Partial refund within paid amount: covered by settlement.integration PARTIAL test (green LIVE);
  the BUG-B invariant change (`<=` total) still admits a partial that fits.

---

## Cleanup (thorough)
Baseline before testing: orders 0, payments 0, orderItems 0, refunds 0, payoutBatch/BatchOrder/
Response/ErrorLog 0, adjustments 0, increasePayments 0, paymentCallbackLog 0, pushJob 30, users 5
(seed owner + admin + mock-buyer-1 + 3 prior-run shop users — left by earlier sessions, NOT mine),
platformConfig 1 active 0.10/0.07, orchard rating 0.

I created: 6 orders (S260627031-036) + their 6 payments + 12 items + 6 paymentCallbackLogs +
4 refunds + 1 payoutBatch + 1 payoutBatchOrder + 1 payoutResponse + 6 pushJobs (payment-paid).
Created NO users (reused mock-buyer-1), changed NO platformConfig, created NO adjustments/
increasePayments/otpLogs, uploaded NO images.

Swept (FK-safe order): payoutResponse 1, payoutBatchOrder 1, payoutBatch 1, refunds 4,
paymentCallbackLog 6, payments 6, orderItems 12, orders 6, pushJob 6 (targeted by orderNo in
message). Also deleted 2 leftover proof PNGs in public/uploads (from the LIVE_DB fulfillment
proof-upload integration test, timestamped during this run) — kept .gitkeep.

Final DB sweep -> exactly baseline: orders 0, payments 0, orderItems 0, refunds 0, all payout
tables 0, adjustments 0, increasePayments 0, paymentCallbackLog 0, pushJob 30, users 5,
platformConfig 1 active 0.10/0.07, orchard rating 0.

Deleted all 6 QA helper scripts (qa-rv-*.mjs). Killed dev server on port 3200 (port CLEAR);
port-3000 Docker app untouched + still listening. `git status` shows only the P5 build+fix surface
— zero QA artifacts.

NOTE on prior residue (not introduced by me): baseline already had 3 shop users
(0851426502/0873889673/0855426261@shop.local) left by an earlier LIVE_DB run. Out of scope for
this re-verify (I added none); flagging so a future full sweep can remove them if desired.

---

## Bottom line
BUG-A PASS. BUG-B PASS. No regression. Both money-critical fixes hold under adversarial live
testing incl. true concurrent HTTP (2x and 5x). Recommend: SHIP.
