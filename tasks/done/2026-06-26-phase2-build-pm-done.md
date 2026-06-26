# Done: Phase 2 build (master/catalog + QC gate + RBAC)
Date: 2026-06-26 | Role: pm

## Decision Log
- grill-me: ran (durable stakes). 4 decisions resolved by user.
- DB migration: run live against Supabase now (.env has DATABASE_URL + DIRECT_URL pooler:5432).
- Verify depth: full live (dev + curl all ACs), not code-only.
- UserOrchardScope: ENFORCE fully in requirePerm (admin sees/edits only orchards in scope; no scope row = full access).
- Commit: commit + push to main. Never commit .env.

## Spec (approved)
- Workflow: B (Feature Build / full-stack) on merged Phase 1 (f5c9767).
- Buyable rule: status=ACTIVE && qcStatus=RELEASED.
- Schema: Lot.qcStatus, enum QcStatus{PENDING RELEASED HOLD DOWNGRADED}, QcAudit, ConsentLog, UserOrchardScope.
- rbac.ts requirePerm(req, perm) + orchard-scope enforcement.
- Admin API (all via requirePerm): orchards GET/POST, orchards/[id] PATCH, lots GET/POST, lots/[id] PATCH, lots/[id]/qc POST (human-only tx + QcAudit), buyers GET. Refactor admin/orders -> requirePerm.
- LIFF guard: liff/lots filter ACTIVE+RELEASED; liff/order reject non-buyable 400.
- Admin screens: (admin)/orchards, (admin)/lots, (admin)/buyers + nav.
- Seed: perms orchards/lots/qc/buyers -> admin role; seed lots qcStatus RELEASED.
- Tests: unit isBuyable + requirePerm decision; integration qc.release/403/PENDING-absent.

## Acceptance Criteria
- Admin w/ perm CRUDs orchards+lots; w/o perm 403.
- Admin outside orchard scope sees/edits only in-scope orchards.
- New lot PENDING -> not buyable (absent liff/lots, order 400).
- qc.release -> RELEASED -> buyable; QcAudit written; human-only.
- HOLD/DOWNGRADE recorded + leaves buyable set.
- /api/admin/buyers lists verified users + latest consent.
- Phase 1 e2e green (seed lots RELEASED).
- live: migrate+seed Supabase, tsc 0 errors, vitest green, dev+curl pass all ACs.

## Risks
- Prisma 7 driver-adapter migrate dev vs Supabase pooler -> may need shadow DB / fallback migrate diff + db execute.
- Orchard-scope enforce: define "no scope = all" to avoid locking out main admin.
- Next.js 16 params Promise + AGENTS.md API changes -> read node_modules/next docs first.

## Spawn Next
Tech Lead -> Developer -> QA (main-loop PM drives each hop).
