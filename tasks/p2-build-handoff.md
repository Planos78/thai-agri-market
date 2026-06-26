# Phase 2 build — handoff (master/catalog + QC + RBAC)

Spec source: `docs/blueprint-adaptation-roadmap.md` §3.2, §3.3, §4 (QC net-new), §7.1, §8 (P2 row).
Builds ON the merged Phase 1 (commit f5c9767). Work in `apps/web`, paths under `src/**`, alias `@/*`.
Stack: Next.js 16 (App Router, `params` is a Promise) + Prisma 7 + Supabase Postgres (@prisma/adapter-pg). DB env already in `.env`.
Stakes: durable. Keep code idiomatic to Phase 1 (NextResponse, prisma.$transaction for writes, RBAC via JWT).

## Goal
Admin can manage orchards + lots; QC gate controls what buyers can purchase; RBAC enforced per permission. LIFF surface stays browse-only.

## 1. Schema (`prisma/schema.prisma`) — extend, don't rewrite
- `Lot`: add `qcStatus QcStatus @default(PENDING)`.
- `enum QcStatus { PENDING RELEASED HOLD DOWNGRADED }`.
- new `QcAudit`: `id`, `lotId`(FK Lot), `fromStatus`, `toStatus`, `action`, `note String?`, `adminUserId`(FK AdminUser), `createdAt`. (human sign-off trail — roadmap §4 QC net-new)
- new `ConsentLog`: `id`, `lineUserId`, `purpose`, `granted Boolean`, `createdAt`. (PDPA trail)
- new `UserOrchardScope`: `@@id([adminUserId, orchardId])`, FKs. (orchard-scoped admins — roadmap §3.2; enforcement optional in P2, model + wiring at least)
- Buyable rule: a lot is buyable iff `status = ACTIVE AND qcStatus = RELEASED`.

## 2. RBAC (`src/lib/rbac.ts` new)
- `export async function requirePerm(req, perm): Promise<{claims}|NextResponse>` — verifyAdminJwt(bearer) -> 401 if none -> 403 if !perms.includes(perm). Reuse in every admin route (refactor admin/orders to use it).
- Permissions used: `orders.read` (exists), `orchards.read`, `orchards.write`, `lots.read`, `lots.write`, `qc.release`, `buyers.read`.

## 3. API routes (`src/app/api/admin/**`, all via requirePerm)
- `orchards` GET(orchards.read) list; POST(orchards.write) create.
- `orchards/[id]` PATCH(orchards.write) update incl `isVerified`.
- `lots` GET(lots.read) list (include orchard); POST(lots.write) create (qcStatus defaults PENDING).
- `lots/[id]` PATCH(lots.write) update fields/status.
- `lots/[id]/qc` POST(qc.release) body `{action:"RELEASE"|"HOLD"|"DOWNGRADE", note?}` -> in `prisma.$transaction`: update `Lot.qcStatus`, write `QcAudit` (from/to/action/adminUserId). **human-only, no auto path** (roadmap §4 approval boundary).
- `buyers` GET(buyers.read) list `VerifiedLineUser` (+ latest consent).
- **Update** `src/app/api/liff/lots/route.ts`: filter `where:{status:"ACTIVE", qcStatus:"RELEASED"}`.
- **Update** `src/app/api/liff/order/route.ts`: reject any lot not `(ACTIVE && RELEASED)` (400).

## 4. Admin screens (`src/app/(admin)/**`, minimal, reuse button)
- `orchards` — list + create form + verify toggle.
- `lots` — list (show qcStatus) + create form + QC buttons (Release/Hold/Downgrade -> POST qc).
- `buyers` — read-only list of verified users + consent.
- add simple nav links on `(admin)/orders`.

## 5. Seed (`prisma/seed.ts`) — extend
- Add Permission rows: orchards.read/write, lots.read/write, qc.release, buyers.read; attach all to "admin" role.
- Set the 3 seeded lots `qcStatus: "RELEASED"` (so Phase 1 browse/order keeps working).

## 6. Tests
- unit: `isBuyable(lot)` pure fn (ACTIVE && RELEASED); requirePerm decision (mock claims).
- integration (live DB or describe.skip): qc.release flips status + writes QcAudit; admin lacking perm -> 403; PENDING lot absent from /api/liff/lots and rejected by /api/liff/order.

## 7. Acceptance criteria
1. Admin w/ perm CRUDs orchards + lots; w/o perm -> 403.
2. New lot starts PENDING -> NOT buyable (absent from liff/lots, order 400).
3. qc.release -> RELEASED -> buyable; `QcAudit` row written; QC is human-only.
4. HOLD/DOWNGRADE recorded + lot leaves buyable set.
5. /api/admin/buyers lists verified users + consent.
6. Phase 1 end-to-end still green (seed lots RELEASED).

## 8. Run + verify
```
cd apps/web
npx prisma migrate dev --name phase2     # Supabase up; or migrate diff offline then deploy
npx prisma db seed
npx tsc --noEmit          # expect 0 errors
npx vitest run            # unit green
npm run dev               # curl admin CRUD + qc + liff browse to confirm ACs
```
Honest report: commands run + real output, AC status, files changed.

## Notes
- Stale `next dev` caches the globalThis PrismaClient — restart the dev server after editing `src/lib/db.ts` or schema/client.
- Do NOT commit `.env`. Commit on a branch or main per owner instruction.
