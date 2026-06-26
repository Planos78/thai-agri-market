# Done: Phase 2 QA — scoped re-verification of the 2 Developer fixes

Date: 2026-06-26 | Role: QA | Stakes: durable | Verdict: **SHIP**

Scope: re-verify ONLY the two fixed paths (Bug 1 route-group collision, Bug 2 AC4 activation)
plus a light regression smoke. No code modified (read-only QA). All test rows cleaned.

## Method
- Clean `npx next build` (Bug 1 build-time), then live `npm run dev` on PORT=3200 (Bug 1 runtime).
- AC4 driven END-TO-END through the live HTTP dev server with curl against the live Supabase DB
  (login -> create -> patch -> qc -> liff), not in-process handlers this time.
- tsc + vitest re-run by QA. DB cleaned + swept via prisma (`node --env-file=.env --import tsx`).
- Left the unrelated port-3000 (Docker) app alone throughout; my server was 3200.

## Bug 1 (P0) — route-group collision -> **PASS**
Build (`npx next build`, fresh `rm -rf .next`):
- `Compiled successfully`, `Finished TypeScript`, 26/26 static pages generated, BUILD_EXIT=0.
- NO "two parallel pages that resolve to the same path" error.
- Route table proves the split:
  - admin pages: `/admin/buyers`, `/admin/login`, `/admin/lots`, `/admin/orchards`, `/admin/orders`
  - LIFF buyer page: `/lots` (distinct path)
Runtime (`npm run dev` on 3200, curl, real HTTP status codes — not 500):
  - GET `/admin/login`  -> 200
  - GET `/admin/lots`   -> 200
  - GET `/lots` (LIFF)  -> 200
  - GET `/api/liff/lots`-> 200
  - GET `/`             -> 200
The app actually builds AND serves. Collision is gone at both build and runtime.

## Bug 2 / AC4 — full real workflow end-to-end (live DB via dev server + curl) -> **PASS**
This is the AC4 that previously FAILED. Sequence (all real HTTP against live DB):
1. POST `/api/admin/auth/login` (admin@thaiagri.local / admin1234 from prisma/seed.ts;
   path unchanged at /api/admin/auth/login) -> 200, JWT issued
   with perms incl. `lots.write`, `qc.release`.
2. POST `/api/admin/lots` {orchardId, fruitName:"QA-REVERIFY-LOT", price:123, quantity:50}
   -> 201, defaults `status=DRAFT, qcStatus=PENDING`.
   -> liff/lots: **present=false** (count stayed 3). Correct: DRAFT+PENDING not buyable.
3. PATCH `/api/admin/lots/{id}` {status:"ACTIVE"}
   -> 200 status=ACTIVE; re-read via admin GET confirms **persisted** (status=ACTIVE, qc=PENDING).
4. POST `/api/admin/lots/{id}/qc` {action:"RELEASE"}
   -> 200, lot.qcStatus=**RELEASED**, and a **QcAudit row WRITTEN**
   (id=9fc448f5-..., fromStatus=PENDING, toStatus=RELEASED, action=RELEASE, adminUserId set).
   qc route flips qcStatus only; status untouched -> two gates preserved.
5. GET `/api/liff/lots` -> lot **present=true, count=4** (status=ACTIVE qc=RELEASED).
   <- the Bug 2 fix: ACTIVE && RELEASED now appears in the buyer catalog end-to-end.

## Smoke (regression, light) -> **PASS**
- `npx tsc --noEmit` -> 0 errors (TSC_EXIT=0).
- `npx vitest run` -> 25 passed | 7 skipped (6 files passed; 2 integration files skipped:
  integration.test, qc.integration — gated on LIVE_DB). Same baseline as before; nothing regressed.
- AC7 (seeded set) -> liff/lots shows exactly the 3 seeded lots
  (ทุเรียน, มังคุด, เงาะ), all ACTIVE+RELEASED — before AND after my test run/cleanup.

## Cleanup
- Deleted the QA test lot + its QcAudit row (deleted: audits=1, lots=1).
- Sweep: QA-named lots=0, orphan audits=0.
- DB totals back to baseline: lots=3, qcAudit=0, liff-visible(ACTIVE&RELEASED)=3 -> **0 QA rows remain**.
- Dev server (PORT=3200) killed; `pgrep next dev|next-server` -> none. Temp tsx scripts removed.
- Unrelated port-3000 app left running (untouched, expected).
- `git status` shows only pre-existing Phase 2 build/Developer-fix artifacts — no stray QA files.

## Verdict: SHIP
Bug 1 (P0): PASS — app builds + serves, no collision. Bug 2 / AC4: PASS — create->activate->release
->present-in-liff/lots holds end-to-end against the live DB. tsc/vitest green, AC7 intact, DB clean.
Both prior defects are genuinely fixed. No new regressions observed in the scoped + smoke checks.
