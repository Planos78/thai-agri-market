# Done: Phase 5 — settlement (payout + refund) + web checkout
Date: 2026-06-27 | Role: developer | Stakes: durable, money-critical

## Migration
- `npx prisma migrate dev --name phase5` -> applied + in sync (no fallback needed).
- Path: `apps/web/prisma/migrations/20260626225420_phase5/migration.sql`
- Adds: Bank, PayoutAccount, PlatformConfig, PayoutBatch(+enum), PayoutBatchOrder, PayoutResponse, PayoutErrorLog, Refund(+3 enums), Order.refundedAmount/source(+OrderSource enum). bug #11: real FKs on PayoutResponse/PayoutErrorLog -> PayoutBatch.

## Self-verify
- `npx prisma generate` + `npx tsc --noEmit` -> 0 errors.
- `npx vitest run` (DB-free) -> 77 passed | 32 skipped (LIVE_DB-gated; +9 new from settlement.integration).
- `LIVE_DB=1 npx vitest run settlement.integration` -> 9/9 passed against live Supabase (payout create/submit/callback->RELEASED; refund PARTIAL/FULL->refundedAmount/REFUNDED; over-refund 422; bad-HMAC payout+refund ->401 zero-writes; shop order source=SHOP; no-session 403). Ran seed to add P5 reference rows first.
- `npx next build` -> exit 0; all new admin/shop/interface routes registered, no collision.

## Money-math
- Take-rate: `money.getRates()` reads active `PlatformConfig` row, env fallback. Pure `calcFee/calcTransferAmount` keep explicit rate args.
- OBS-1: `calcTransferAmount = Math.max(0, round2(total-fee-vat-refund))`. P4 test asserting -240.75 updated to 0; money.test + settlement.test add clamp cases.
- OBS-2: new `canAdjustOrder(status)` (true only PAID/PREPARING/RESCHEDULED) wired into proposeAdjustment/decideAdjustment/proposeReschedule/decideReschedule -> 409 on DELIVERED/CANCELLED/EXPIRED.

## Files created
- lib: settlement.ts, settlement-tx.ts, order-create.ts; tests: settlement.test.ts, settlement.integration.test.ts; vitest.setup.ts.
- routes: api/admin/{payout-accounts[+/[id]], payout-batches[+/[id]/submit], refunds[+/[id]/approve], platform-config}; api/interface/{payout,refund}/callback; api/shop/{lots,otp,otp/check,order[+/[id]/payment]}; app/(shop)/{layout, shop, shop/cart, shop/verify, shop/order/[id][+/pay]}.

## Files changed
- schema.prisma, seed.ts (5 perms + banks + PlatformConfig + demo PayoutAccount), money.ts, psp.ts (payout/refund/callbacks + throw-loud selector), fulfillment.ts/-tx.ts (OBS-2), auth.ts (shop session), liff/order/route.ts (uses shared createOrder), admin+liff reschedule routes (handle new error return), vitest.config.ts (setupFiles + testTimeout 30s), .env.example (SHOP_SESSION_SECRET; PSP note), money.test/fulfillment.test/fulfillment.integration.test.

## Env vars (.env.example)
- SHOP_SESSION_SECRET (new). PSP_PROVIDER/PAYMENT_SECRET_KEY notes updated (payout+refund reuse same HMAC secret; non-mock provider throws loud).

## Gate 0 / convention
- All money state changes in prisma.$transaction. Callbacks verify HMAC before any DB access. Payout/refund create+approve+submit human-only (perm-gated; no cron/auto). Mock PSP only; getPsp() throws loud on any non-mock provider.

## Notes
- testTimeout raised to 30s (remote Supabase round-trips; default 5s too tight). DB-free unit suite unaffected (<10ms).
- npm workspace: dotenv hoisted to repo-root node_modules (in apps/web devDeps); prisma.config.ts already imported dotenv/config.
</content>
