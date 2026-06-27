# Done: Phase 7 — reports + reconciliation + scheduled jobs (cron)
Date: 2026-06-27 | Role: developer | Stakes: durable | FINAL phase

## Migration
- `cd apps/web && npx prisma migrate dev --name phase7` -> applied clean (live Supabase reachable, no fallback needed).
- Path: `apps/web/prisma/migrations/20260627092356_phase7/migration.sql` (CronLog + ReconciliationSnapshot).
- `prisma validate`: PASS. Re-ran `prisma/seed.ts` to grant the 3 new perms to admin.

## Self-verify (all green)
- `npx prisma generate` -> OK.
- `npx tsc --noEmit` -> 0 errors.
- `npx vitest run` (DB-free) -> 109 passed / 45 integration skipped (incl 13 new phase7 unit tests).
- `set -a && . ./.env && set +a && LIVE_DB=1 npx vitest run phase7.integration` -> 6/6 passed.
- `npx next build` -> exit 0; all cron + report routes registered, no /admin collision.

## Files created
- Schema: CronLog `@@unique([task,period])`, ReconciliationSnapshot (standalone, no back-relations).
- lib: `cron.ts` (cronAuthorized, periodKey, claimCronPeriod/finishCron — P2002 dedup), `expiry-sweep.ts` (pure selectExpiredOrderIds + $transaction sweep), `reminder.ts`, `reconciliation.ts` (pure computeReconciliation), `reports.ts` (revenue/wht/refunds aggregation + computeWht + toCsv), `report-params.ts` (window parse/validate).
- Cron routes: `api/cron/expiry-sweep` (5-min slot dedup, $transaction Order->EXPIRED + Payment->FAILED/REFUNDED), `api/cron/reminder` (hourly dedup, enqueuePush only).
- Admin routes (perm-gated): `api/admin/reports/{revenue,expense,refunds,wht,raw}` (reports.read), `.../reconciliation` (reconciliation.read), `.../reconciliation/freeze` (reconciliation.write, 409 on dup period).
- Pages: `(admin)/admin/reports/page.tsx`, `(admin)/admin/reports/reconciliation/page.tsx` (red variance banner).
- Tests: `phase7.test.ts` (13 unit), `phase7.integration.test.ts` (6 LIVE_DB).
- Config: `apps/web/vercel.json` crons; `.env.example` += WHT_RATE=0.03 (CRON_SECRET already present).

## Files changed
- `prisma/schema.prisma`, `prisma/seed.ts` (+reports.read, reconciliation.read, reconciliation.write).

## Env vars
- WHT_RATE (default 0.03) added to .env.example. CRON_SECRET already documented. `.env` untouched.

## vercel.json crons
- expiry-sweep `*/10 * * * *`, reminder `0 * * * *`, push-sweep `*/5 * * * *`. (Sub-daily needs Vercel Pro — flagged by tech lead.)

## Reconcile formula
- variance = round2(paymentsIn - payoutsOut - refundsOut - platformFee - heldEscrow). PLANT clawback refunds EXCLUDED (recover INTO platform). Balanced ledger -> 0. Per-order rowVariance flags unexplained rows. READ-ONLY; no money mutation (freeze writes only the snapshot).

## Notes
- Deferred per spec: ReportRunningNo, ScheduleReport, payout-retry cron, per-order lastRemindedAt, WHT certs.
- No commit made (per task rule). Did NOT run dev/curl (QA's job).
