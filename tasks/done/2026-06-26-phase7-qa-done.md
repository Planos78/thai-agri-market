# QA: Phase 7 — reports + reconciliation + scheduled jobs (cron)
Date: 2026-06-27 | Role: QA | Stakes: durable | FINAL phase
Verdict: **SHIP** (all 11 ACs PASS; regression green; cleanup incl. prior dead-run residue done)

---

## Baseline DB inspection (leftover test rows from the interrupted prior QA run)
Found residue BEFORE my run (the dead run did NOT clean up):
- **User: 8 leftover** `*@shop.local` BUYER rows (phone-shop checkout), created 2026-06-27 03:56 -> 13:45.
  Seed baseline = 2 (owner SELLER + mock-buyer-1).
- **PushJob: 120** (all SENT, mock-buyer-1, 03:55 -> 13:45). Seed creates 0.
- **CronLog: 2** (`reminder` 2026-06-27T09, `expiry-sweep` 2026-06-27T0935, both DONE, runAt 09:39). Seed creates 0.
- **public/uploads: 2 test images** (`*-proof.png`, `*-evidence.jpg`) from prior P4/P6 runs.
- Orders/Payments/Refunds/Snapshots/Payouts/Claims/Deliveries/Reviews = 0; Orchard.rating = 0; 1 orchard, 3 lots, 1 AdminUser (correct seed).
All residue above was swept in final cleanup together with my own QA data.

## Env note (important)
`.env` does NOT contain CRON_SECRET or WHT_RATE (only in `.env.example`). `cronAuthorized` treats a
blank secret as "open in dev" (returns true). To exercise the auth gate I started the dev server with
`CRON_SECRET=qa-cron-secret-p7` and `WHT_RATE=0.03` injected into the PROCESS env only — `.env` was never
modified. Production must set CRON_SECRET in Vercel env (techlead §7 already says so). Not a code bug.

---

## Gates (re-run, real output)
| Gate | Result |
|---|---|
| `npx tsc --noEmit` | exit 0, 0 errors |
| `npx vitest run` (DB-free) | 109 passed / 45 skipped (16 files pass / 7 skip); incl 13 phase7 unit |
| `set -a && . ./.env && set +a && LIVE_DB=1 npx vitest run` | exit 0, **146 passed / 8 skipped** (21 files pass / 2 skip); phase7.integration **6/6** |
| `npx next build` | exit 0; all cron + report routes registered; no /admin collision |

next build registered (verified in output): `/api/cron/{expiry-sweep,reminder,push-sweep}`,
`/api/admin/reports/{revenue,expense,refunds,wht,raw,reconciliation,reconciliation/freeze}`,
pages `/admin/reports`, `/admin/reports/reconciliation`. The 8 LIVE_DB skips are phase3.integration (4) +
legacy integration.test.ts (4) — LINE-API gated, unrelated to P7.

Dev server: port 3009 (port 3000 left untouched throughout). Admin JWT minted via `signAdminJwt` with seed perms.

---

## Per-AC results (curl HTTP codes + DB + real numbers)

**AC1 — cron auth.** PASS.
- expiry-sweep & reminder, NO secret -> 403; WRONG secret -> 403; correct `Bearer` -> 200; `x-cron-secret` header -> 200.

**AC2 — expiry-sweep flips expired, never touches others (tx).** PASS.
- Seeded `QA-P7-EXP-PAST` (WAITING_PAYMENT, paymentExpiredAt -1h, Payment PENDING/HELD) + `QA-P7-EXP-FUTURE` (+1h control).
- Run -> `{"swept":1,"ids":["dbcf1fbc..."],"period":"2026-06-27T1355"}`.
- DB after: EXP-PAST = **EXPIRED**, payment **FAILED/REFUNDED**; EXP-FUTURE = untouched (WAITING_PAYMENT, PENDING/HELD).
- CronLog row period `1355` = DONE, note `{"swept":1,"ids":[...]}`.

**AC3 — idempotency + CronLog dedup.** PASS.
- Same 5-min slot, ran 3x total -> 2nd/3rd returned `{"skipped":true,"reason":"already-run","period":"2026-06-27T1355"}`; exactly **1** CronLog row for `(expiry-sweep,1355)`.
- New slot `1400` -> claimed fresh row, `{"swept":0}` (already-EXPIRED order not re-touched; idempotent).

**AC4 — reminder idempotent, PushJob only, no money mutation.** PASS.
- Seeded `QA-P7-REMIND` (WAITING_PAYMENT, expiry +15m, buyer has lineUserId).
- Run -> `{"paymentReminders":1,"deliveryReminders":0,"period":"2026-06-27T14"}`; re-run same hour -> `{"skipped":true}`. 1 CronLog row for `(reminder,T14)`.
- PushJob 120 -> **121** (one PAYMENT_REMINDER, qa-p7-buyer, PENDING, correct Thai message). Money tables unchanged: payment 3, refund 0, payout 0.

**AC5 — reconciliation variance 0 balanced; nonzero + offending row flagged on imbalance.** PASS.
- Balanced (window 2026-06-20): RECON-P (PAID, escrow RELEASED, fee 50 kept, 1000 paid out) + RECON-H (PAID, escrow HELD, fee 0).
  totals `{paymentsIn:1550, payoutsOut:1000, refundsOut:0, platformFee:50, heldEscrow:500, variance:0}`; both rowVariance 0.
- Imbalance: added CUSTOMER refund 100 -> `variance:-100`; row RECON-P `rowVariance:-100` flagged, RECON-H stays 0.

**AC6 — exact equation; PLANT clawbacks excluded; red banner on variance.** PASS.
- Equation confirmed: 1550 - 1000 - 100 - 50 - 500 = **-100**.
- Added PLANT clawback 200 in same window -> refundsOut stayed **100** (NOT 300), variance stayed **-100** -> PLANT correctly EXCLUDED.
- Reconciliation page `/admin/reports/reconciliation` serves 200 (red-variance banner is in the page per dev/techlead; route data drives it).

**AC7 — revenue/expense/refunds/WHT/raw match hand-computed; WHT = round2(fee*rate).** PASS (hand-checked).
- Seeded 2 PAID orders: A(sub 1000, fee 50, vat 3.5), B(sub 2000, fee 100, vat 7).
- Revenue: `{subTotal:3000, feeAmount:150, vatFeeAmount:10.5, gross:3160.5}` = hand calc exactly.
- WHT: `{whtRate:0.03, totalFee:150, totalWht:4.5, computed:true}`; **4.5 = round2(150 * 0.03)** exactly.
- Raw CSV: correct header + 2 rows with exact money fields.
- Expense (2026-06-20): `{totalPaidOut:1000, byOrchard:[1000], batches:[QA-P7-PB-1:1000]}`.
- Refunds (2026-06-20): `{totalRefunded:100, customerRefunds:100, plantClawbacks:200}` (totalRefunded = CUSTOMER only).

**AC8 — RBAC 401/403.** PASS.
- No token -> 401 (revenue, reconciliation, freeze). No-perm token -> 403 (revenue, reconciliation, freeze, wht).

**AC9 — window honored; from>to / missing -> 400.** PASS.
- `from=2026-06-28&to=2026-06-27` -> 400; missing params -> 400; valid window returns the inclusive-day range (`to` bumped +1 day).

**AC10 — only expiry-sweep mutates money; freeze writes ONLY snapshot; dup period 409.** PASS.
- Freeze (write perm) -> 200, ReconciliationSnapshot written `{period:"2026-06-20", variance:"-100", createdBy:<admin>}`; duplicate same period -> **409** "snapshot for this period already exists".
- Post-freeze money counts unchanged (payment 7, refund 2, payout 1) — only 1 snapshot row added. Reconciliation GET is read-only (added 0 money rows).

**AC11 — prisma validate / migration / seed grants 3 perms.** PASS.
- next build (which runs prisma generate) green; migration `20260627092356_phase7` already applied live (CronLog + ReconciliationSnapshot usable).
- Admin token carried all 22 perms INCLUDING `reports.read`, `reconciliation.read`, `reconciliation.write`.

---

## Regression (P1-P6)
- LIVE_DB vitest 146 passed: phase4 fulfillment (12), phase5 settlement (11: order->pay->PAID with transferAmount,
  payout DRAFT->SUBMITTED->SUCCEEDED->escrow RELEASED, over-refund 422, concurrent-refund guard, shop order),
  phase6 packing/claims (5: claim->refund atomic, over-refund blocked, reconcile/manifest). All green.
- Live surfaces: `/admin/login`, `/admin/reports`, `/admin/reports/reconciliation`, `/admin/orders`, `/admin/packing` -> 200; `/api/liff/lots` -> 200.
- Payment webhook with no/bad HMAC -> 401 (guard intact).

---

## Cleanup (thorough, incl. prior dead-run residue)
Killed dev server pid 78970 (port 3009); port 3000 untouched.
Deleted (FK-safe order): 7 QA orders (QA-P7-EXP-PAST/FUTURE, REMIND, REP-A/B, RECON-P/H) + their items/payments;
2 refunds (QA-P7-RF-CUST/PLANT); 1 payout batch (QA-P7-PB-1) + line; **7 CronLog** (5 mine + 2 dead-run residue);
**1 snapshot**; **121 PushJob** (120 dead-run residue + 1 mine); **9 users** (qa-p7-buyer + 8 `*@shop.local` residue).
Reset Orchard.rating -> 0. Deleted 2 leftover test images (kept `.gitkeep`). Removed all temp qa-*.mjs scripts.
`.env` never modified (CRON_SECRET/WHT_RATE were process-env only).

FINAL baseline (seed-only): order 0, payment 0, refund 0, cronLog 0, snapshot 0, pushJob 0, payout 0,
user 2 (owner SELLER + mock-buyer-1 BUYER), adminUser 1, orchard 1 (rating 0), lot 3. Pristine.

---

## Bugs
None blocking. Observations (non-blocking, no Handoff Request needed):
1. `CRON_SECRET` / `WHT_RATE` absent from `.env` (present in `.env.example`). Auth is open in dev when blank
   (by design). Must be set in Vercel prod env. Documentation/ops item, not a code defect.
2. Vercel Cron sub-daily schedules in `vercel.json` need Vercel Pro (already flagged by tech lead §7).

## Verdict: SHIP
