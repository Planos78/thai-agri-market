# Tech Lead: Phase 2 build (master/catalog + QC gate + RBAC)
Date: 2026-06-26 | Role: tech-lead | Stakes: durable

Source of truth: `tasks/p2-build-handoff.md`. This spec resolves the open technical decisions so the Developer executes without guessing. Work in `apps/web`, paths under `src/**`, alias `@/*`. Next.js 16 + Prisma 7 + Supabase (@prisma/adapter-pg at runtime).

---

## 1. Schema deltas (`prisma/schema.prisma`) — exact Prisma 7 syntax

Add `qcStatus` to `Lot` (place after `status`):
```prisma
  status          LotStatus @default(DRAFT)
  qcStatus        QcStatus  @default(PENDING)
```
Add to `Lot` relation block (back-relation for QcAudit):
```prisma
  orchard    Orchard     @relation(fields: [orchardId], references: [id])
  orderItems OrderItem[]
  qcAudits   QcAudit[]
```
New enum (place after `enum LotStatus`):
```prisma
enum QcStatus {
  PENDING
  RELEASED
  HOLD
  DOWNGRADED
}
```
New models (place in a new `// QC / consent / scope` section):
```prisma
model QcAudit {
  id          String   @id @default(uuid())
  lotId       String
  fromStatus  QcStatus
  toStatus    QcStatus
  action      String   // "RELEASE" | "HOLD" | "DOWNGRADE"
  note        String?
  adminUserId String
  createdAt   DateTime @default(now())

  lot       Lot       @relation(fields: [lotId], references: [id])
  adminUser AdminUser @relation(fields: [adminUserId], references: [id])

  @@index([lotId])
}

model ConsentLog {
  id         String   @id @default(uuid())
  lineUserId String
  purpose    String
  granted    Boolean
  createdAt  DateTime @default(now())

  @@index([lineUserId])
}

model UserOrchardScope {
  adminUserId String
  orchardId   String

  adminUser AdminUser @relation(fields: [adminUserId], references: [id])
  orchard   Orchard   @relation(fields: [orchardId], references: [id])

  @@id([adminUserId, orchardId])
}
```
Add back-relations to existing models so `prisma validate` passes:
- `AdminUser` (after `role AdminRole @relation(...)`):
```prisma
  qcAudits     QcAudit[]
  orchardScope UserOrchardScope[]
```
- `Orchard` (after `lots Lot[]`):
```prisma
  scopes UserOrchardScope[]
```
`ConsentLog` has no FK to `VerifiedLineUser` (keyed by `lineUserId` string, mirrors `OtpLog`); no back-relation needed.

## 2. Migration strategy — run live NOW

Connection IS already configured for the CLI in `prisma.config.ts` (Prisma 7 puts it there, not in the `datasource` block):
- `datasource.url = process.env["DIRECT_URL"] ?? process.env["DATABASE_URL"]`
- `migrations.seed = "tsx prisma/seed.ts"` (so `prisma db seed` works)
- Phase 1 `0001_phase1` was created/applied through exactly this path -> proven working. Do NOT add `url`/`directUrl` to `schema.prisma`.

Primary command sequence (from `apps/web`):
```
npx prisma migrate dev --name phase2
npx prisma db seed
npx tsc --noEmit
npx vitest run
npm run dev    # curl ACs
```
Shadow DB: `prisma migrate dev` provisions a shadow DB on the SAME connection (`DIRECT_URL`). `.env` `DIRECT_URL` and `DATABASE_URL` are BOTH the pooler host on `:5432` (session mode, not pgbouncer transaction mode), so shadow-DB create/drop should succeed.

Fallback (only if `migrate dev` fails on shadow DB) — diff-based, no shadow DB:
```
npx prisma migrate diff \
  --from-schema-datasource prisma/schema.prisma \
  --to-schema-datamodel prisma/schema.prisma \
  --script > prisma/migrations/0002_phase2/migration.sql
# create the folder first; then apply:
npx prisma db execute --file prisma/migrations/0002_phase2/migration.sql --schema prisma/schema.prisma
npx prisma migrate resolve --applied 0002_phase2
npx prisma generate
```
After any schema/client change restart `next dev` (stale globalThis PrismaClient — handoff Notes).

## 3. RBAC contract (`src/lib/rbac.ts` — new)

`claims.sub` = AdminUser id (confirmed `auth.ts:42` sets subject to sub). Use it as `adminUserId`.

```ts
import { NextResponse } from "next/server";
import { verifyAdminJwt, bearer, type AdminClaims } from "@/lib/auth";
import { prisma } from "@/lib/db";

// 401 if no/invalid jwt; 403 if missing perm. Return claims on success.
export async function requirePerm(
  req: Request,
  perm: string,
): Promise<AdminClaims | NextResponse> {
  const claims = await verifyAdminJwt(bearer(req) ?? "");
  if (!claims) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!claims.perms.includes(perm))
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  return claims;
}

// "ALL" = no scope rows (do not lock out main admin). Otherwise the allowed orchardIds.
export async function scopedOrchardIds(
  claims: AdminClaims,
): Promise<string[] | "ALL"> {
  const rows = await prisma.userOrchardScope.findMany({
    where: { adminUserId: claims.sub },
    select: { orchardId: true },
  });
  return rows.length === 0 ? "ALL" : rows.map((r) => r.orchardId);
}

export function inScope(scope: string[] | "ALL", orchardId: string): boolean {
  return scope === "ALL" || scope.includes(orchardId);
}
```
Route usage pattern (every admin route):
```ts
const claims = await requirePerm(req, "lots.read");
if (claims instanceof NextResponse) return claims;
```
Scope application per route:
- `orchards` GET: `scope === "ALL" ? {} : { where: { id: { in: scope } } }`.
- `orchards/[id]` PATCH: `if (!inScope(scope, id)) return 403`.
- `lots` GET: filter `where.orchardId in scope` when not ALL.
- `lots` POST: load/validate `body.orchardId`; `if (!inScope(scope, body.orchardId)) return 403`.
- `lots/[id]` PATCH & `lots/[id]/qc` POST: load lot -> `if (!inScope(scope, lot.orchardId)) return 403`.

## 4. Route contracts (`src/app/api/admin/**`, writes via `prisma.$transaction`)

Next.js 16: `[id]` signature is `{ params }: { params: Promise<{ id: string }> }` then `const { id } = await params;` (matches existing `liff/order/[id]/payment`).

| File | Method | Perm | Request body | Response | Codes |
|---|---|---|---|---|---|
| `orchards/route.ts` | GET | orchards.read | - | `{orchards:[...]}` | 200/401/403 |
| `orchards/route.ts` | POST | orchards.write | `{name,province,ownerId,description?}` | `{orchard}` | 201/400/401/403 |
| `orchards/[id]/route.ts` | PATCH | orchards.write | `{name?,province?,description?,isVerified?}` | `{orchard}` | 200/400/401/403/404 |
| `lots/route.ts` | GET | lots.read | - | `{lots:[...]}` include orchard | 200/401/403 |
| `lots/route.ts` | POST | lots.write | `{orchardId,fruitName,price,quantity,variety?,grade?,unit?,minOrderQty?,...dates}` | `{lot}` qcStatus=PENDING by default | 201/400/401/403 |
| `lots/[id]/route.ts` | PATCH | lots.write | lot fields incl `status` | `{lot}` | 200/400/401/403/404 |
| `lots/[id]/qc/route.ts` | POST | qc.release | `{action:"RELEASE"\|"HOLD"\|"DOWNGRADE", note?}` | `{lot,audit}` | 200/400/401/403/404 |
| `buyers/route.ts` | GET | buyers.read | - | `{buyers:[{...,latestConsent}]}` | 200/401/403 |
| `orders/route.ts` (refactor) | GET | orders.read | - | unchanged | 200/401/403 |

qc route (human-only, single tx, no auto path):
```ts
const claims = await requirePerm(req, "qc.release");
if (claims instanceof NextResponse) return claims;
const { id } = await params;
const lot = await prisma.lot.findUnique({ where: { id } });
if (!lot) return 404;
// scope check via inScope(scope, lot.orchardId) -> 403
const map = { RELEASE: "RELEASED", HOLD: "HOLD", DOWNGRADE: "DOWNGRADED" } as const;
const toStatus = map[action]; if (!toStatus) return 400;
const result = await prisma.$transaction(async (tx) => {
  const updated = await tx.lot.update({ where: { id }, data: { qcStatus: toStatus } });
  const audit = await tx.qcAudit.create({ data: {
    lotId: id, fromStatus: lot.qcStatus, toStatus, action, note: note ?? null,
    adminUserId: claims.sub,
  }});
  return { lot: updated, audit };
});
```
`buyers`: `prisma.verifiedLineUser.findMany(...)`; latest consent = `prisma.consentLog.findFirst({ where:{lineUserId}, orderBy:{createdAt:"desc"} })` per buyer (or one grouped query). Refactor `orders/route.ts` to use `requirePerm(req, "orders.read")` replacing the inline verify/perm check (lines 7-11).

LIFF updates:
- `liff/lots/route.ts:7` -> `where: { status: "ACTIVE", qcStatus: "RELEASED" }`.
- `liff/order/route.ts:36` -> `where: { id: { in: ... }, status: "ACTIVE", qcStatus: "RELEASED" }`. The existing `if (!lot)` guard at line 42 then returns 400 for any non-buyable lot (PENDING/HOLD/DOWNGRADED). Optionally call `isBuyable` per lot before push for clarity, but the `findMany` filter is the enforcement point.

## 5. `isBuyable` pure fn — `src/lib/lots.ts` (new)
```ts
export function isBuyable(lot: { status: string; qcStatus: string }): boolean {
  return lot.status === "ACTIVE" && lot.qcStatus === "RELEASED";
}
```
Use in `liff/order` and `liff/lots` is optional (filter does the work); the fn exists primarily for unit test + future reuse.

## 6. Test plan (`src/lib/__tests__/`, vitest, `*.test.ts`)
- `lots.test.ts` — unit `isBuyable`: ACTIVE+RELEASED=true; ACTIVE+PENDING=false; DRAFT+RELEASED=false; SOLD_OUT+RELEASED=false; HOLD/DOWNGRADED=false.
- `rbac.test.ts` — unit `requirePerm` decision with mocked `verifyAdminJwt`/`bearer` (vi.mock `@/lib/auth`): no token -> 401; valid token missing perm -> 403; valid token with perm -> returns claims object. Also `inScope`: "ALL" -> true; member -> true; non-member -> false. Mock `prisma` for `scopedOrchardIds` (0 rows -> "ALL"; N rows -> ids).
- `qc.integration.test.ts` — `describe.skip` (or gate on `process.env.LIVE_DB`): qc RELEASE flips PENDING->RELEASED + writes QcAudit row; admin lacking `qc.release` -> 403; PENDING lot absent from `/api/liff/lots` and rejected (400) by `/api/liff/order`.

## 7. Admin screens (`src/app/(admin)/**`, minimal)
Follow existing pattern exactly: `"use client"`, `sessionStorage.getItem("adminToken")` -> redirect `/login` if absent, `fetch(url,{headers:{authorization:`Bearer ${token}`}})`, render table, reuse `@/components/ui/button`.
- `(admin)/orchards/page.tsx` — list + create form + verify toggle (PATCH isVerified).
- `(admin)/lots/page.tsx` — list (show qcStatus) + create form + QC buttons Release/Hold/Downgrade -> POST `lots/[id]/qc`.
- `(admin)/buyers/page.tsx` — read-only list of verified users + latest consent.
- Add nav links to the other admin pages on `(admin)/orders/page.tsx`.

## 8. Seed (`prisma/seed.ts`) — extend
- Add Permission rows: `orchards.read/write`, `lots.read/write`, `qc.release`, `buyers.read`; attach all to the `admin` role via `AdminRolePermission`.
- Set the 3 seeded lots `qcStatus: "RELEASED"` so Phase 1 browse/order stays green.

## Alternatives Considered
1. Add `url`/`directUrl` to `datasource` block in schema.
   Trade-off: redundant — `prisma.config.ts` already supplies the CLI URL; editing the block risks breaking the proven Phase 1 path. Rejected.
2. Enforce orchard scope in a middleware wrapper instead of per-route.
   Trade-off: cleaner but hides 403 logic and needs route-type introspection; per-route `inScope` is explicit and 6 routes is not enough to justify the abstraction (KISS). Rejected.
3. Chosen — config-file CLI connection (unchanged) + per-route `requirePerm`/`scopedOrchardIds`/`inScope` helpers.
   Why: zero risk to Phase 1 migration path; explicit, testable, matches existing inline-check idiom.

## KISS Gate
Simpler path checked: yes — `requirePerm` collapses the 5-line inline check into one call; `inScope` keeps scope logic flat (no class/middleware). No premature abstraction.

## Cross-Cutting Concerns
- Security: RBAC + orchard scope = core of this task (covered).
- Database/Scale: writes in `$transaction`; `@@index` on QcAudit.lotId, ConsentLog.lineUserId.
- Compliance: ConsentLog = PDPA trail; QcAudit = human sign-off trail.
- Observability/i18n/Cost: no new owners needed for P2.

## Notes / Risks
- If shadow DB fails on the pooler, use the §2 fallback (diff + db execute + resolve).
- Do NOT commit `.env`. Restart `next dev` after schema/db.ts edits.
- `prisma db seed` resolves via `prisma.config.ts migrations.seed` (NOT a `package.json#prisma` block — there is none).

## Code Review: N/A (no code written; spec only)
## Spawn: none — control returns to PM. Next hop: Developer.
