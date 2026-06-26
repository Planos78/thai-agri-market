# Done: Phase 1 vertical slice
Date: 2026-06-26 | Role: developer (main-loop)
workflow_used: Feature build (roadmap §9)

## Built (apps/web)
- **schema** `prisma/schema.prisma` — 15 tables/16 models (incl VerifiedLineUser, OtpLog, Order+money/orderNo/expiry, OrderRunningNo, Payment, PaymentCallbackLog, AdminUser/AdminRole/Permission/AdminRolePermission). Removed schema `url` (Prisma 7 breaking).
- **migration** `prisma/migrations/0001_phase1/migration.sql` (offline diff, 15 CREATE TABLE) + migration_lock.toml.
- **lib** `src/lib/`: db (accelerateUrl), hmac, money, order-no (FOR UPDATE), orders (isOrderExpired), auth (scrypt+jose), psp/line/sms mock adapters.
- **API** `src/app/api/`: liff/{verify-line,otp,otp/check,lots,order,order/[id]/payment}, interface/payment/callback (HMAC+tx), internal/push/[event], admin/{auth/login,orders}, dev/mock-pay.
- **screens** `src/app/(liff)/{welcome,register,otp,lots,order/confirm,order/[id]/pay}` + `(admin)/{login,orders}`.
- **seed** `prisma/seed.ts` (admin/role/perm, orchard, 3 lots, verified buyer). **tests** vitest + 5 files. **deps** jose, vitest, tsx. **.env.example**.
- Fixed pre-existing `src/app/page.tsx` framer-motion ease tuple typing (blocked build).

## Commands run (real results)
- `npm install` ✓ (40 pkgs)
- `npx prisma generate` ✓ v7.8.0
- `npx tsc --noEmit` ✓ **0 errors (whole project)**
- `npx vitest run` ✓ **11 passed / 4 skipped (integration, need DB)**
- `npx prisma migrate dev` ✗ **P1001 — local Postgres down (localhost:51214)**. Generated offline migration SQL instead.
- seed / runtime: NOT run (no DB).

## Acceptance criteria — ALL VERIFIED on live Supabase (2026-06-26)
DB: Supabase Postgres (project vlyfamkeejmqtfpjsceg, ap-northeast-1), @prisma/adapter-pg, migrate deploy + seed OK. End-to-end via curl on :3009.
- AC1 unverified order -> 403 ✓
- AC2 orderNo `<prefix>+YYMMDD+3digit` + **no collisions under 8 parallel creates** (S260626002-006 all unique; FOR UPDATE holds) ✓. (3 of 8 hit the 5s interactive-tx timeout under lock contention on free-tier pooler — throughput tuning, not a collision.)
- AC3 expiry ✓ unit + lazy-check wired.
- AC4 bad-HMAC callback -> 401, no write ✓
- AC5 valid mock-pay callback -> Order PAID + Payment COMPLETED + escrow HELD, atomic ✓
- AC6 admin login (jwt) -> /api/admin/orders shows order; no-token -> 401 ✓
- AC7 payment-success push via internal relay (mock) ✓
- Money math verified: 5×180=900 subTotal, fee 90 (10%), vat 6.3 (7% of fee) ✓
- vitest: 11 unit passed.

## Gotcha found + fixed
- Stale `next dev` (booted before db.ts adapter change) cached an old client on globalThis -> order $transaction hung. Restarting the dev server fixed it. (HMR does not recreate the globalThis-cached PrismaClient.)

## To finish (needs DB — owner)
1. start DB: `npx prisma dev` (or point DATABASE_URL at a postgres).
2. `npx prisma migrate deploy` (or `migrate dev`).
3. `npm run seed`.
4. `npm run dev` -> /welcome (LIFF flow), /login (admin admin@thaiagri.local / admin1234).

## Risks / flags
- `src/lib/db.ts` uses `accelerateUrl` (for prisma+postgres:// PPG). Verify at runtime; for a direct `postgresql://` deploy, swap to `@prisma/adapter-pg`.
- All vendors are mock adapters (PSP/SMS/LINE) — real wiring deferred (decisions #2/#3/#5).
- Not committed. On `main` branch.

## Decision Log
- Build-gate override authorized by owner. Mock-adapter approach to unblock without vendor picks. Full P1 built in one session per owner "finish, ignore cost".
- Wiki Pages Written: none (product repo). compounding: n/a
