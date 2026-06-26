# Done: Phase 2 build (master/catalog + QC gate + RBAC)
Date: 2026-06-26 | Role: developer | Stakes: durable

## Migration
- PRIMARY path worked: `npx prisma migrate dev --name phase2`. Shadow DB on the Supabase pooler (`:5432` session mode) succeeded. No fallback needed.
- Output: `Applying migration 20260626102824_phase2 ... Your database is now in sync with your schema.`
- `prisma migrate status` -> "2 migrations found ... Database schema is up to date!"
- migration.sql: `CREATE TYPE QcStatus`, `ALTER TABLE Lot ADD COLUMN qcStatus`, `CREATE TABLE QcAudit/ConsentLog/UserOrchardScope` + all FKs.

## Seed
- `npx prisma db seed` -> "seed done". First attempt failed with stale client (`Unknown argument qcStatus`); fixed by `npx prisma generate` then reseed (handoff Note: stale globalThis/client). Added `lot.updateMany -> qcStatus RELEASED` so pre-existing Phase 1 lots (default PENDING) become RELEASED.

## Verify
- `npx tsc --noEmit` -> 0 errors (TSC_EXIT=0).
- `npx vitest run` -> 6 passed | 2 skipped files; **25 passed | 7 skipped** tests (lots 6, rbac 8, plus existing). qc.integration gated on LIVE_DB (skipped).

## Files created
- `src/lib/rbac.ts` (requirePerm + scopedOrchardIds + inScope, full scope enforcement)
- `src/lib/lots.ts` (isBuyable)
- `src/app/api/admin/orchards/route.ts` (GET/POST), `orchards/[id]/route.ts` (PATCH, inScope+404)
- `src/app/api/admin/lots/route.ts` (GET/POST, scope on read + create), `lots/[id]/route.ts` (PATCH), `lots/[id]/qc/route.ts` (POST, human-only, Lot update + QcAudit in one `$transaction`)
- `src/app/api/admin/buyers/route.ts` (GET + latestConsent)
- `src/app/(admin)/orchards/page.tsx`, `(admin)/lots/page.tsx`, `(admin)/buyers/page.tsx`
- `src/lib/__tests__/lots.test.ts`, `rbac.test.ts`, `qc.integration.test.ts`
- `prisma/migrations/20260626102824_phase2/migration.sql`

## Files changed
- `prisma/schema.prisma` (Lot.qcStatus, enum QcStatus, QcAudit/ConsentLog/UserOrchardScope, back-relations on Lot/Orchard/AdminUser)
- `prisma/seed.ts` (6 perms attached to admin role; seeded lots qcStatus RELEASED + updateMany)
- `src/app/api/admin/orders/route.ts` (refactor -> requirePerm)
- `src/app/api/liff/lots/route.ts` (where: ACTIVE+RELEASED)
- `src/app/api/liff/order/route.ts` (findMany where: ACTIVE+RELEASED; existing !lot guard returns 400)
- `src/app/(admin)/orders/page.tsx` (nav links)

## Notes
- Scope: ENFORCED fully per approved decision (scopedOrchardIds + inScope on every scoped route; "no scope rows = ALL"). orchards POST not scoped (no orchardId pre-create), matches spec.
- Did NOT commit. Did NOT touch .env. Did NOT run dev/curl (QA hop).
