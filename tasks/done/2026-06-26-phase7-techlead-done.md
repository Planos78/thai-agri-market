# Tech Lead: Phase 7 — reports + reconciliation + scheduled jobs (cron)
Date: 2026-06-27 | Role: tech-lead | Stakes: durable | SPEC ONLY (no feature code)

Grounded in: docs/blueprint-adaptation-roadmap.md (§3.4/§3.5, §4 scheduled-jobs, §7.1, Flow 8, §11.2);
prisma/schema.prisma (Order/Payment/Refund/PayoutBatch*/PaymentCallbackLog/PlatformConfig);
api/cron/push-sweep/route.ts; lib/{money,settlement,rbac,push,order-create}.ts; prisma.config.ts.
`prisma validate` on proposed schema: **PASS** ("The schema ... is valid").

---

## 0. KISS gate + alternatives

- **KISS:** every cron job = one HTTP route mirroring `push-sweep` (no new infra). Reports/reconcile = read queries over existing money columns + `groupBy`. Only 1-2 new tables. No queue, no worker, no warehouse.
- **Reconcile storage — chosen: on-demand query + OPTIONAL snapshot table.**
  1. On-demand only — simplest; no audit trail / history. Trade-off: cheap, but "what was variance last Tue" is unanswerable.
  2. Mandatory daily snapshot via cron — full history. Trade-off: extra write path + dedup, more moving parts for a number humans read live.
  3. **Chosen:** compute live (source of truth = ledger) + `ReconciliationSnapshot` written only when an admin clicks "freeze" (or an optional daily cron). Why over 1: keeps an audit trail. Why over 2: snapshot is never on the hot path; live query is always authoritative.
- **Lot release on expiry — none needed.** `order-create.ts` does NOT decrement/reserve lot qty (confirmed: no `reservedQty`/`decrement`). So `expiry-sweep` flips order status only; no inventory release. (Convention text said "if applicable" — it is not.)

---

## 1. Schema deltas (Prisma 7) — validated

Append to `prisma/schema.prisma` (no edits to datasource/existing models):

```prisma
// Once-per-period cron dedup (roadmap §3.5 cron_logs; PK task+period).
model CronLog {
  id     String   @id @default(uuid())
  task   String   // "expiry-sweep" | "reminder" | "push-sweep"
  period String   // "2026-06-27" (daily) | "2026-06-27T14" (hourly) | "2026-06-27T1405" (5-min slot)
  status String   @default("RUNNING") // RUNNING | DONE | FAILED
  note   String?  // JSON summary (counts, ids)
  runAt  DateTime @default(now())

  @@unique([task, period])
  @@index([task, runAt])
}

// Optional daily/monthly reconcile audit snapshot. Reconcile is computed live; this
// only freezes a result + variance for history. Never on the hot path. createdBy kept
// a soft String (audit ref) to avoid a back-relation on AdminUser.
model ReconciliationSnapshot {
  id          String   @id @default(uuid())
  period      String   @unique // "2026-06-27" or "2026-06"
  paymentsIn  Decimal  @default(0)
  payoutsOut  Decimal  @default(0)
  refundsOut  Decimal  @default(0)
  platformFee Decimal  @default(0)
  heldEscrow  Decimal  @default(0)
  variance    Decimal  @default(0)
  note        String?
  createdBy   String   // AdminUser.id
  createdAt   DateTime @default(now())

  @@index([createdAt])
}
```

- **`ReportRunningNo` — DEFER** (roadmap §3.4 marks it defer; reports are query/CSV exports, not numbered legal docs in P7). Add later only if WHT-certificate PDFs need a gap-free doc number. Not trivial enough to justify now.
- No back-relations needed: both tables are standalone audit/dedup tables (mirrors `OrderRunningNo`, `ConsentLog` which carry no relations).

---

## 2. Cron jobs (each `api/cron/<job>/route.ts`, mirror push-sweep)

Carry the exact `push-sweep` auth shape: `CRON_SECRET` via `authorization: Bearer <secret>` OR `x-cron-secret`; GET+POST both call one `handle`.

**Dedup contract (all jobs):**
1. Compute `period` for the job's cadence (daily=`YYYY-MM-DD`, hourly=`...THH`, 5-min=`...THHMM` floored to slot).
2. `cronLog.upsert` is NOT used for the guard — use `create` inside try; on unique-violation (P2002 on `@@unique([task,period])`) -> already ran this period -> return `{ skipped: true, reason: "already-run" }`. (Atomic claim: first caller wins; Vercel retry/double-fire is a no-op.)
3. Do the work; on success update the CronLog row `status="DONE", note=<JSON counts>`. On throw, set `status="FAILED"` (best-effort) and 500.
   - Idempotency is double-guarded: even if a job is forced to re-run, the *work itself* is idempotent (sweep only touches orders still WAITING_PAYMENT; reminder skips orders already reminded — see below).

**`expiry-sweep`** (MUTATES, `$transaction`) — deferred from P1, now built:
- Select `Order where status=WAITING_PAYMENT AND paymentExpiredAt < now()`.
- Per order, in `prisma.$transaction`: `order.update -> status=EXPIRED`; `payment.update -> status=FAILED, escrowStatus=REFUNDED` (escrow on an unpaid order was only ever HELD-as-intent; no money moved, so no Refund row). No lot release (no reservation exists).
- Idempotent: re-run selects nothing (status no longer WAITING_PAYMENT). Cadence: every 5-15 min (period = 5-min slot).
- Selection logic extracted to a pure fn `selectExpiredOrderIds(orders, now)` for unit test.

**`reminder`** (READ + enqueue push) — uses P3 `enqueuePush(tx, ...)`:
- **Payment reminder:** `Order where status=WAITING_PAYMENT AND paymentExpiredAt BETWEEN now() AND now()+REMIND_WINDOW` (e.g. 30 min before expiry). Push to buyer (`order.buyer.user.lineUserId`).
- **Delivery reminder:** `Order where status IN (PAID,PREPARING) AND deliveryDate = tomorrow` (date-only match).
- Anti-double-remind: the CronLog `(reminder, <period>)` dedup already caps it to one run per period; choose period=hourly so a given order falls in one reminder bucket. (No per-order flag needed; if finer control is wanted later add `Order.lastRemindedAt`, deferred.)
- Cadence: hourly.

**`push-sweep`** — ALREADY EXISTS (P3). P7 only adds its `vercel.json` cron entry + (optional) a CronLog `(push-sweep, <5-min slot>)` guard. No code change required; note it.

**Optional `payout-retry` — DEFER.** Payout batches are human-submitted (P5); there is no auto-retry requirement in the roadmap. Out of P7 scope.

---

## 3. Reports (admin, perm `reports.read`)

All under `api/admin/reports/<name>`, `requirePerm(req, "reports.read")`, GET, params `from`/`to` (ISO date, inclusive day range -> `createdAt`/`paidAt` window), optional `orchardId` (scope-filtered via `scopedOrchardIds`). Money math reuses `lib/money.ts` (`round2`); never re-derive rates inline. Decimal summed in JS after `findMany`/`groupBy` (amounts are per-row Decimal; convert with `Number()` then `round2`).

| Report | Source rows | Aggregation | Response shape |
|---|---|---|---|
| **Revenue** | `Order` paid in window (`paidAt` in [from,to], status NOT IN CANCELLED/EXPIRED) | sum `subTotal`, sum `feeAmount`, sum `vatFeeAmount`; group by orchard (via `OrderItem.lot.orchardId`) when `orchardId` absent | `{ from,to, totals:{subTotal,feeAmount,vatFeeAmount,gross}, byOrchard:[{orchardId,name,subTotal,fee,vat}] }` |
| **Expense / payout** | `PayoutBatchOrder` whose batch `status=SUCCEEDED, settledAt` in window | sum `amount` (the actual transferAmount paid out), group by orchard | `{ from,to, totalPaidOut, byOrchard:[...] , batches:[{batchNo,settledAt,total}] }` |
| **Refunds** | `Refund status=SUCCEEDED, settledAt` in window | sum `amount`, split by `payoutType` (CUSTOMER vs PLANT) | `{ from,to, totalRefunded, customerRefunds, plantClawbacks, rows:[{refundNo,orderNo,amount,kind,payoutType,settledAt}] }` |
| **WHT** | same paid `Order` set as Revenue | withholding tax = `round2(feeAmount * WHT_RATE)` where `WHT_RATE=Number(process.env.WHT_RATE ?? "0.03")` (service-fee WHT 3%); computed COLUMN, not stored | `{ from,to, whtRate, totalFee, totalWht, byOrchard:[{orchardId, fee, wht}] }` |
| **Raw** | join `Order + Payment + items` in window | none (line-per-order) | CSV or JSON array: `orderNo,paidAt,status,subTotal,feeAmount,vatFeeAmount,totalAmount,transferAmount,refundedAmount,channel,providerRef` |

- WHT note: P7 ships WHT as a derived 3% of platform service fee (`feeAmount`), env-configurable, no schema. Real WHT certificates / `ReportRunningNo` deferred. Flag in response that it is computed, unaudited.
- Each report also has an admin console page under `(admin)/admin/reports/<name>` (date pickers + table + CSV download button). Pages are thin; logic lives in the API route.

---

## 4. Reconciliation / variance console (admin, perm `reconciliation.read`)

Route `GET api/admin/reports/reconciliation?from&to[&orchardId]`; console page `(admin)/admin/reports/reconciliation`. READ-ONLY. Humans resolve variance; **no auto-write to money tables.** Optional `POST .../reconciliation/freeze` (perm `reconciliation.write`) writes a `ReconciliationSnapshot`.

**Reconcile equation (exact columns, for the window):**

```
paymentsIn  = sum(Order.totalAmount)            where Order.paidAt in [from,to]   AND Order.status != EXPIRED   // cash actually collected (Payment.status=COMPLETED)
payoutsOut  = sum(PayoutBatchOrder.amount)      where batch.status=SUCCEEDED AND batch.settledAt in [from,to]
refundsOut  = sum(Refund.amount)                where Refund.status=SUCCEEDED AND Refund.settledAt in [from,to] AND payoutType=CUSTOMER
platformFee = sum(Order.feeAmount + Order.vatFeeAmount)  over the same paid Order set as paymentsIn
heldEscrow  = sum(Order.totalAmount)            where Payment.escrowStatus=HELD   (paid, not yet paid-out or refunded)

variance = round2( paymentsIn
                   - payoutsOut
                   - refundsOut
                   - platformFee
                   - heldEscrow )
```

- **Identity:** every baht that came IN must equal (paid to orchards) + (refunded to customers) + (platform keeps fee+VAT) + (still held in escrow). On a balanced ledger **variance == 0**.
- PLANT clawback refunds are NOT subtracted (they recover money INTO the platform, not out) — they reduce a future `payoutsOut`, so excluding them keeps the identity. Document this explicitly in the route.
- **Workbook view:** response = `{ from,to, totals:{paymentsIn,payoutsOut,refundsOut,platformFee,heldEscrow,variance}, rows:[ per-order: {orderNo, paidAt, totalAmount, fee+vat, paidOut, refunded, escrowStatus, rowVariance} ] }`. Per-order `rowVariance = totalAmount - (fee+vat) - paidOut - refunded - (heldEscrow? totalAmount : 0)`; rows where `rowVariance != 0` are the **unexplained** ones the console highlights.
- Gate: console shows a banner `UNEXPLAINED VARIANCE: <amount>` red unless 0. QA accepts only variance==0 on the balanced fixture.
- Pure fn `computeReconciliation(rows)` (no DB) for unit test of the math.

---

## 5. Route contracts table

| Route | Method | Auth | Params | Mutates | Codes | Response |
|---|---|---|---|---|---|---|
| `/api/cron/expiry-sweep` | GET/POST | CRON_SECRET | — | YES (`$transaction`: Order->EXPIRED, Payment->FAILED/REFUNDED) | 200 / 403 / 500 | `{ swept:n, ids[], skipped? }` |
| `/api/cron/reminder` | GET/POST | CRON_SECRET | — | enqueue PushJob only | 200 / 403 / 500 | `{ paymentReminders:n, deliveryReminders:n, skipped? }` |
| `/api/cron/push-sweep` | GET/POST | CRON_SECRET | — | PushJob retries (existing) | 200 / 403 | `{ ... }` (P3) |
| `/api/admin/reports/revenue` | GET | perm `reports.read` | from,to,orchardId? | no | 200 / 401 / 403 | revenue shape |
| `/api/admin/reports/expense` | GET | perm `reports.read` | from,to,orchardId? | no | 200 / 401 / 403 | expense shape |
| `/api/admin/reports/refunds` | GET | perm `reports.read` | from,to | no | 200 / 401 / 403 | refunds shape |
| `/api/admin/reports/wht` | GET | perm `reports.read` | from,to,orchardId? | no | 200 / 401 / 403 | wht shape |
| `/api/admin/reports/raw` | GET | perm `reports.read` | from,to,format=json\|csv | no | 200 / 401 / 403 | rows / CSV |
| `/api/admin/reports/reconciliation` | GET | perm `reconciliation.read` | from,to,orchardId? | no | 200 / 401 / 403 | workbook shape |
| `/api/admin/reports/reconciliation/freeze` | POST | perm `reconciliation.write` | from,to | YES (snapshot insert) | 200 / 401 / 403 / 409(dup period) | snapshot |

All admin routes return 401 (no/invalid JWT) then 403 (missing perm) via `requirePerm`. All cron routes 403 on bad secret. Validate `from<=to`; bad params -> 400.

---

## 6. RBAC perms (seed into admin role, `prisma/seed.ts` perms array)

```ts
["reports.read", "Read financial reports"],
["reconciliation.read", "Read reconciliation console"],
["reconciliation.write", "Freeze reconciliation snapshots"],
```

Seed grants all three to the existing `admin` role (the seed already loops every perm onto admin via `adminRolePermission.upsert`).

---

## 7. vercel.json crons (config — NOT code)

Create `apps/web/vercel.json`. Vercel Cron hits each path on schedule with `authorization: Bearer $CRON_SECRET` automatically (CRON_SECRET set in Vercel env). This is the ONLY wiring; no in-process ticker (roadmap §11.2).

```json
{
  "crons": [
    { "path": "/api/cron/expiry-sweep", "schedule": "*/10 * * * *" },
    { "path": "/api/cron/reminder",     "schedule": "0 * * * *" },
    { "path": "/api/cron/push-sweep",   "schedule": "*/5 * * * *" }
  ]
}
```

- expiry-sweep every 10 min (window: order HOLD_MS; >=1 sweep before/at expiry). reminder hourly. push-sweep every 5 min (existing job; backoff buckets are 1/5/15 min).
- Note: Vercel Hobby caps cron frequency to daily; Pro needed for sub-daily. Flag to PM/DevOps — schedules above assume Pro.

---

## 8. Test plan (mirror existing LIVE_DB-gated pattern in `lib/__tests__`)

**Unit (pure, no DB):**
- `selectExpiredOrderIds`: picks only WAITING_PAYMENT past `paymentExpiredAt`; ignores PAID/already-EXPIRED/future-expiry.
- `computeReconciliation`: balanced fixture -> variance 0; inject an unmatched payout -> variance != 0 and correct row flagged.
- report aggregation fns (revenue sum, WHT = fee*rate, refund split CUSTOMER/PLANT) on fixtures; assert `round2` consistency.
- CronLog period bucketing (daily/hourly/5-min slot from a fixed `now`).

**Integration (LIVE_DB-gated, `describe.skipIf(!process.env.LIVE_DB)`):**
- expiry-sweep: seed a WAITING_PAYMENT order with `paymentExpiredAt` in past -> run handler -> order EXPIRED, payment FAILED/REFUNDED. **Run 2nd time -> 0 swept (idempotent)**; assert CronLog dedup (same period -> `skipped:true`, distinct period -> runs).
- reconcile: seed a known balanced dataset (1 paid order -> 1 SUCCEEDED payout + platform fee + escrow RELEASED) -> route returns variance 0; add an extra refund -> variance reflects it.
- reports: seed paid orders -> revenue/expense/wht/refunds return exact sums.

Coverage target >=80% on new lib fns (Refinement gate).

---

## 9. Migration

`cd apps/web && npx prisma migrate dev --name phase7` (uses DIRECT_URL via prisma.config.ts; datasource untouched). Migration dir: `prisma/migrations/<ts>_phase7/`.
Fallback if shadow-db/migrate blocked: `prisma migrate diff --from-schema-datasource prisma/schema.prisma --to-schema-datamodel prisma/schema.prisma --script > m.sql` (or diff from-empty), apply via `prisma db execute --file m.sql`, then `prisma migrate resolve --applied <name>`. Mirrors prior phase fallback.

---

## 10. Acceptance criteria (numbered, for QA)

1. All cron routes return 403 without valid `CRON_SECRET` (Bearer or x-cron-secret), 200 with it.
2. `expiry-sweep` flips every WAITING_PAYMENT order past `paymentExpiredAt` to EXPIRED (payment FAILED/REFUNDED) inside a transaction; never touches PAID/DELIVERED/already-EXPIRED orders.
3. `expiry-sweep` 2nd run in same period -> `skipped:true` via CronLog `@@unique([task,period])`; in a NEW period and with no eligible orders -> sweeps 0 (idempotent both ways).
4. `reminder` enqueues at most one payment reminder per eligible order per run and one delivery reminder for next-day deliveries; re-run in same period -> skipped (no double push).
5. Reconciliation route returns `variance == 0` on a balanced seeded dataset; introduces non-zero variance when a payout/refund is unmatched, and flags the offending per-order rows.
6. Reconcile equation uses exactly: paymentsIn - payoutsOut - refundsOut - platformFee - heldEscrow (PLANT clawbacks excluded); console shows red banner when variance != 0.
7. Revenue/Expense/Refunds/WHT/Raw reports return sums matching hand-computed fixtures; WHT = round2(feeAmount * WHT_RATE).
8. All admin report + reconciliation routes 401 without JWT, 403 without the required perm (`reports.read` / `reconciliation.read` / `reconciliation.write`).
9. Reports honor `from`/`to` window and `orchardId` scope (scoped admin sees only in-scope orchards); `from>to` -> 400.
10. No cron job mutates money tables except expiry-sweep (orders/payment only); reconciliation/freeze writes only `ReconciliationSnapshot`, never Refund/Payout/Payment.
11. `npx prisma validate` passes; `phase7` migration applies cleanly; seed grants the 3 new perms to admin.

---

## Alternatives Considered
1. In-process scheduler (node-cron / setInterval in a long-lived server) — rejected: serverless has no durable process (roadmap §11.2); double-fire on cold starts.
2. Mandatory daily reconcile snapshot computed by cron — rejected as default: snapshot on hot path; live ledger is the source of truth. Kept as opt-in freeze.
3. **Chosen:** Vercel Cron -> CRON_SECRET HTTP routes (mirror push-sweep), CronLog `(task,period)` dedup, reports/reconcile as on-demand read queries. Why: zero new infra, idempotent by construction, matches the one proven cron pattern already in the repo.

## Cross-Cutting Concerns
- Security: cron secret gating (existing pattern); admin perms gate reports; reconciliation read-only re money. YES -> covered.
- Observability: CronLog.note carries per-run counts/ids -> queryable run history. YES.
- DB/Scale: report queries are date-windowed + indexed (`Order.paidAt`? add index if absent — note for developer); reconcile is per-period bounded. Watch full-table scans on Raw export -> stream/paginate if large (defer).
- Cost: Vercel Cron frequency needs Pro plan (flagged §7).
- i18n/a11y/Compliance: WHT is a tax artifact — P7 ships a computed estimate only; real WHT certs + accountant sign-off are out of scope (build-gate, roadmap §1/Gate 0).

## Notes / deferred
- `ReportRunningNo`, `ScheduleReport` (email report schedule), `payout-retry` cron, per-order `lastRemindedAt`, WHT certificate PDFs — all deferred.
- Add `@@index([paidAt])` and `@@index([status, paymentExpiredAt])` on Order if not present — improves sweep + report selection (developer to confirm against current schema indexes).
