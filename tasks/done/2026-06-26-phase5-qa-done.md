# QA: Phase 5 — Settlement (payout + refund) + Web Checkout

Date: 2026-06-27 | Role: QA (independent, adversarial) | Stakes: durable, MONEY-CRITICAL
Branch: main | apps/web | Migration 20260626225420_phase5 applied live (Supabase)
Method: re-ran all gates, drove the LIVE dev server (port 3100) with real curl/fetch + real
HMAC signing, verified DB rows + actual money numbers via Prisma. Trusted nothing from the
done docs. PSP_PROVIDER=mock throughout (Gate 0).

## VERDICT: needs-fix
Core settlement logic is sound and almost all ACs pass with real evidence, BUT two real bugs
were found by live testing — one money-critical (BUG-B: over-refund / double-pay via concurrent
in-flight refunds) and one functional gap (BUG-A: a normally-paid order can never be paid out).
Both are documented with repro below. No code was changed by QA.

---

## Gates (re-run, real output)
| Gate | Command | Result |
|---|---|---|
| Typecheck | `npx tsc --noEmit` | exit 0, 0 errors |
| Unit (DB-free) | `npx vitest run` | 77 passed / 32 skipped (13 files) exit 0 |
| Integration | `LIVE_DB=1 npx vitest run` | 101 passed / 8 skipped exit 0 (settlement.integration 9/9 in 48.7s; fulfillment.integration 12/12 — no longer empty stubs, BUG-1 carry-forward addressed) |
| Build | `npx next build` | exit 0; all P5 routes registered, no collision (admin payout-accounts/payout-batches/refunds/platform-config; interface payout+refund callbacks; shop lots/order/otp + (shop) pages) |

LIVE_DB suite is self-cleaning except it left 1 shop User (`0846939020@shop.local`) and 1
proof image in public/uploads — swept in cleanup.

---

## Per-AC results (live evidence)

| AC | Title | Result | Evidence |
|---|---|---|---|
| 1 | Migration up-to-date, FKs (bug #11) | PASS | build+generate green; PayoutResponse written with FK `payoutBatchId` populated (see AC5); unknown-batchNo callback writes NO orphan row (FK respected) |
| 2 | Take-rate from PlatformConfig (no hardcoded 2%) | PASS | active cfg 0.10. POST platform-config -> 0.125; new SHOP order S260627020: subTotal=1800 fee=**225** vatFee=**15.75** (was 180/12.6 at 0.10). Restored to 0.10; verified active row back to 0.10/0.07. `money.getRates()` reads active row, env fallback. |
| 3 | OBS-1 transfer clamp >= 0 | PASS | `calcTransferAmount(900,90,6.3,900)=0` (not -96.30); partial `2070-207-14.49-180=1668.51`. money.test asserts the clamp to 0 (old -96.30 assertion updated). |
| 4 | OBS-2 guard (adjust/reschedule on settled) | PASS | DELIVERED order: INCREASE -> **409** "order not adjustable in state DELIVERED"; REDUCE -> 409; reschedule -> 409. `canAdjustOrder` true only PAID/PREPARING/RESCHEDULED, wired into 4 tx fns. |
| 5 | Payout batch create->submit->callback | PASS | create DRAFT batchNo PB260627007 totalAmount=**1607.40**, PayoutBatchOrder.amount=**1607.40** (snapshot); submit -> SUBMITTED + pspBatchRef=MOCK-PB-...; good-HMAC callback -> batch **SUCCEEDED**, escrow HELD->**RELEASED**, PayoutResponse.accepted=true, FK present. Human-only (perm-gated). |
| 6 | Refund create+approve (full+partial), over-refund | **PARTIAL** | FULL: refundedAmount=900=total, escrow+payment **REFUNDED**. PARTIAL (adj 180): refundedAmount=180, escrow stays HELD. Single-shot over-refund create returns guard. **BUT** concurrent in-flight refunds bypass the guard -> BUG-B (see below). |
| 7 | Bad HMAC payout+refund -> 401, zero writes | PASS | payout bad-sig -> 401, PayoutResponse count unchanged (1->1). refund bad-sig -> 401, refund stays PENDING, refundedAmount unchanged. |
| 8 | Web checkout SHOP, money == LIFF | PASS | shop OTP -> check -> httpOnly session; no-session create -> **403**; create SHOP order S260627019 source=SHOP subTotal=1800 fee=180 vatFee=12.6 (identical math to LIFF via shared createOrder); pay -> good-HMAC callback -> **PAID** + payment COMPLETED+HELD. |
| 9 | RBAC on every admin route | PASS | no token -> **401** (payout-accounts/refunds/platform-config). Token missing perm -> **403** (GET+POST). Read-only token (payout.read/refund.read): GET 200, POST **403** (write-gated). |
| 10 | Gate 0 — no real funds, throw loud | PASS | PSP_PROVIDER=mock everywhere; `getPsp()` with PSP_PROVIDER=omise **throws** "refusing to move real funds"; mock returns MockPsp. All approvals human-only (no cron/auto path; grep confirms). |
| 11 | Default suite green; integration real assertions | PASS | 77 DB-free pass; integration suites contain real create->call->assert-DB logic (verified by reading + 101 LIVE pass). |

### Regression (P1-P4)
| Check | Result |
|---|---|
| LIFF lots GET | 200 |
| Admin orders GET (RBAC) | 200 |
| Payment callback BAD HMAC | 401 |
| LIFF order -> mock-pay -> PAID | PAID, payment COMPLETED+HELD, PushJob created (4->5) |
| P4 fulfillment integration | 12/12 LIVE pass (reschedule/adjust/delivery/proof/review) |
| Webhook HMAC suite | 9/9 pass |

---

## BUGS

### BUG-A (functional gap, high): a normally-paid order can never be paid out
`transferAmount` is `Decimal?` with NO default (schema line 138) and is set **only** by
`fulfillment-tx.ts` (adjustment-decide recompute line 212, and cancel/reject line 75).
`order-create.ts` (the shared LIFF+SHOP create) computes `feeAmount`/`vatFeeAmount` but
NEVER sets `transferAmount`. The payment callback (`interface/payment/callback`) flips the
order to PAID + escrow HELD but also never sets `transferAmount`. Payout eligibility reads
`Number(o.transferAmount ?? 0)` -> 0 -> `isPayoutEligibleAmount(0)=false` -> ineligible.

Result: the happy path "buyer pays -> orchard gets paid out" is broken. Only orders that
went through an adjustment or a cancel ever become payout-eligible. The settlement.integration
test masks this by hand-seeding `transferAmount: 2009.25`.

Repro (live, observed):
```
create SHOP order (qty 10 @180): subTotal=1800 fee=180 vatFee=12.6 transfer=null
pay -> PAID, escrow HELD
POST /api/admin/payout-batches {orderIds:[<paid order>]}
-> 422 {"error":"no eligible orders: [{...\"reason\":\"transferAmount not > 0\"}]"}
```
Same applies to LIFF orders (S260627021 paid via mock-pay -> transferAmount=null).

Fix direction (for dev, not applied): compute `transferAmount = calcTransferAmount(total, fee,
vatFee, 0)` at order-create (or set it on payment-SUCCESS in the callback). Either keeps it
consistent with the OBS-1 clamp.

### BUG-B (MONEY-CRITICAL, double-pay): over-refund via concurrent in-flight refunds
`isRefundWithinLimit` (settlement.ts) checks only `order.refundedAmount` (sum of SUCCEEDED
refunds) + the new amount. It does NOT count PENDING / approved-but-unsettled refunds. So
multiple overlapping FULL refunds can each be created (201), approved, and settled — the sum
of paid refunds then exceeds the order total.

Repro (live, observed) on a 2250-baht order already partial-refunded 180 (SUCCEEDED):
```
POST /api/admin/refunds {kind:FULL}  -> 201 amount=2070 (PENDING)   # remaining = 2250-180
POST /api/admin/refunds {kind:FULL}  -> 201 amount=2070 (PENDING)   # SHOULD be 422, isn't
approve + good-HMAC callback both    -> both SUCCEEDED
=> order.refundedAmount = 180 + 2070 + 2070 = 4320  vs total 2250  (escrow REFUNDED)
*** OVER-REFUND / DOUBLE-PAY: 4320 paid on a 2250 order ***
```
The single sequential create-approve-settle-then-create path IS guarded (the integration test
does only sequential, so it passed). This is a TOCTOU-style gap that real concurrent operators
or a double-click can hit.

Fix direction (for dev, not applied): include PENDING (non-terminal) refund amounts in the
over-refund invariant at create time, e.g. `sum(SUCCEEDED) + sum(PENDING) + new <= total`,
inside the create `$transaction` (it already runs in a tx, so add the pending-sum query there).

---

## Take on the 2 flagged decisions
1. **Take-rate in PlatformConfig table (vs env).** Correct call — verified it works live
   (rate change reflected on a new order, env fallback intact). Keep. Minor: the platform-config
   POST creates a NEW row and deactivates the prior each time, so the table accumulates history
   rows; that is intended (auditable experiments) but means "restore" creates a 3rd row rather
   than reactivating — fine for audit, just be aware the active row is always the newest.
2. **Payout eligibility = PAID + escrow HELD (vs DELIVERED).** Reasonable for hold-then-payout,
   BUT given BUG-A, the PAID+HELD eligibility currently selects nothing in the happy path. Once
   BUG-A is fixed, PAID+HELD is the right default; narrow to DELIVERED only if owner wants
   delivery-confirmed payout. No blocker beyond BUG-A.

---

## Cleanup (THOROUGH — my run + prior dead-run residue)
Baseline before testing: 6 orders (S260626001-006, all test — seed creates NO orders), 3 prior
shop users (0890662534/0859214931/0891542874), platformConfig=1 (clean), payout/refund=0.

Swept (all confirmed gone, DB back to seed-only):
- Orders: deleted all 13 (6 prior dead-run + 7 mine) + their payments/items/callback logs.
- Users: deleted 6 test users (3 prior shop + 1 LIVE_DB-suite shop user 0846939020 + my
  0999000111/0999000222). Kept seed owner + mock-buyer-1.
- payoutBatch/payoutBatchOrder/payoutResponse/payoutErrorLog: 0. refund: 0. adjustment: 0.
- pushJob: 0. otpLog: 0. paymentCallbackLog: 0.
- PlatformConfig drift restored: deleted my 2 QA rows (0.125 + the restore-created 0.10),
  reactivated the original "seed bootstrap" 0.10/0.07 row -> 1 active row.
- Orchard.rating reset to 0 (was already 0; no reviews created).
- public/uploads: deleted leftover `3fe74e29-...-proof.png` (from today's LIVE_DB proof test);
  kept `.gitkeep`.
- Killed dev server on port 3100; port 3000 (Docker app) untouched.
- Deleted all QA helper scripts (qa-db.js, qa-sweep.js, qa-token.mjs, qa-e2e*.mjs,
  qa-cleanup.mjs). git status shows only the P5 build surface, no QA artifacts.

Final DB sweep confirmed: orders=0, users=2 (seed), platformConfig=1 active (seed bootstrap),
banks=6, payoutAccount=1 (seed demo), lots=3, perms=15, verifiedLineUser=1, orchard rating=0.

---

## Bottom line
Ship-blocking: BUG-B (money-critical double-pay) must be fixed. BUG-A (payout happy-path dead)
should be fixed before this phase is useful end-to-end. Everything else (HMAC, Gate 0, escrow
transitions, take-rate config, OBS-1 clamp, OBS-2 guard, RBAC, web checkout, regression) PASSES
with real evidence. Recommend: Handoff back to developer for BUG-A + BUG-B, then QA re-verify
the two repros.
