# Done: Phase 2 QA — independent verification (master/catalog + QC gate + RBAC)
Date: 2026-06-26 | Role: QA | Stakes: durable | Verdict: **NEEDS-FIX**

## Method
- Re-ran tsc + vitest (not trusted from prior hop).
- Attempted live dev server (`npm run dev`) -> **app does not compile** (Bug 1, P0). Every HTTP route returns 500.
- Worked around the dead HTTP layer by invoking the REAL route handler functions in-process via a tsx harness against the LIVE Supabase DB (same prisma client + adapter the app uses). This exercises the genuine RBAC/QC/scope handler code, only bypassing the broken Next.js page-compile path.
- All test rows created were removed; DB verified clean (see Cleanup).

## Baseline checks (re-run by QA)
- `npx tsc --noEmit` -> **0 errors** (TSC_EXIT=0).
- `npx vitest run` -> **25 passed | 7 skipped** (6 files passed, 2 skipped: qc.integration gated on LIVE_DB, integration.test). Green.
- NOTE: tsc + vitest pass but DO NOT catch Bug 1 — route-group path collision is a Next.js build-time concern, not type/unit.

## Per-AC results (evidence = real status codes / DB fields from in-process handler calls on LIVE DB)

### AC1 — RBAC: PASS
- admin token: `GET /api/admin/orchards` 200, `GET /api/admin/lots` 200, `POST orchards` 201, `POST lots` 201.
- no token: orchards GET 401 `{error:"unauthorized"}`, lots GET 401.
- token w/ empty perms (minted via signAdminJwt): orchards GET 403 `{error:"forbidden"}`, lots POST 403. (403 path also covered by rbac.test.ts 8 tests.)

### AC2 — Orchard scope: PASS
- Inserted UserOrchardScope(admin, QA-orchard). `GET /api/admin/orchards` returned EXACTLY the one scoped orchard (`ids.length===1 && ids[0]===QA orchard`).
- `PATCH` an out-of-scope (seeded) orchard -> **403** `{error:"forbidden"}`.
- Scope row removed mid-run; final sweep confirms `UserOrchardScope` total = 0 -> main admin back to ALL access.

### AC3 — New lot PENDING not buyable: PASS
- `POST /api/admin/lots` -> `status=DRAFT, qcStatus=PENDING` (default).
- ABSENT from `GET /api/liff/lots` (present=false).
- `POST /api/liff/order` referencing it -> **400** `{error:"lot ... not available"}`.

### AC4 — qc RELEASE -> buyable + audit + human-only: **PARTIAL / FAIL** (Bug 2)
- `POST /api/admin/lots/{id}/qc {action:"RELEASE"}` -> 200, lot `qcStatus=RELEASED`. PASS.
- QcAudit row WRITTEN: `{from:PENDING, to:RELEASED, action:RELEASE, adminUserId:<admin>}`. PASS.
- Human-only / no auto path: PASS — only entry point is the qc route behind `requirePerm("qc.release")`; flips happen inside one `$transaction` writing both Lot + QcAudit; no scheduler/seed/webhook writes qcStatus=RELEASED with an audit. (Seed sets RELEASED via `updateMany` with NO audit — that is data-seeding, not a runtime auto-release path.)
- **FAIL half:** lot did NOT appear in `/api/liff/lots` after RELEASE (present=false). Root cause: created lot stays `status=DRAFT`; RELEASE only flips `qcStatus`; buyable rule = `ACTIVE && RELEASED`. AC4 requires "now PRESENT in /api/liff/lots" — not met for a lot created+released through the normal admin flow. See Bug 2.

### AC5 — HOLD / DOWNGRADE recorded + leaves buyable set: PASS
- `{action:"HOLD"}` 200, `{action:"DOWNGRADE"}` 200; both wrote QcAudit rows.
- Full audit trail captured: `PENDING->RELEASED(RELEASE)`, `RELEASED->HOLD(HOLD)`, `HOLD->RELEASED(RELEASE)`, `RELEASED->DOWNGRADED(DOWNGRADE)`.
- Lot ABSENT from `/api/liff/lots` after HOLD and after DOWNGRADE (present=false both). (Buyable-leaving verified; note this lot was also DRAFT so it was never buyable to begin with — the negative is correct but doubly enforced. Positive buyable transition is proven separately, see "Gate proof".)

### AC6 — buyers list + latest consent: PASS
- `GET /api/admin/buyers` 200; returned verified user `mock-buyer-1` with `latestConsent` field present (value null — no ConsentLog rows seeded yet, field correctly populated).

### AC7 — Phase 1 regression: PASS
- 3 seeded lots all `status=ACTIVE, qcStatus=RELEASED`.
- All 3 present in `/api/liff/lots` (3 of 3).
- `POST /api/liff/order` against seeded lot (ทุเรียน, qty=minOrderQty 5) -> **201**, order `S260626007`, subTotal 900, escrow HELD. Phase 1 flow intact.

### Gate proof (supplemental, separates gate-correctness from Bug 2)
- Created lot -> `PATCH {status:"ACTIVE"}` -> `qc RELEASE` -> lot is `ACTIVE+RELEASED` and **PRESENT in /api/liff/lots = true**. The buyable gate logic itself is correct; the defect is the missing activation step in the admin workflow.

## BUGS

### Bug 1 (P0, BLOCKER) — Route-group collision: app does not compile
- **Symptom:** every route (pages + API) returns HTTP 500. Fresh `npm run dev` on a clean port reproduces.
- **Error:** `You cannot have two parallel pages that resolve to the same path. Please check /(admin)/lots and /(liff).`
- **Root cause:** `src/app/(admin)/lots/page.tsx` and `src/app/(liff)/lots/page.tsx` are both route groups (parentheses stripped from URL), so BOTH resolve to `/lots`. Next.js refuses to build. Same applies conceptually to other (admin) pages but `lots` is the first collision reported. `(admin)/orchards`,`(admin)/buyers`,`(admin)/orders` do not collide by name today, but `(admin)/lots` vs `(liff)/lots` is fatal.
- **Repro:**
  ```
  cd apps/web && PORT=3100 npm run dev      # "Ready" prints (lazy compile)
  curl -s -o /dev/null -w "%{http_code}" http://localhost:3100/            # 500
  curl -s -o /dev/null -w "%{http_code}" http://localhost:3100/api/liff/lots  # 500
  # dev log: "two parallel pages that resolve to the same path ... /(admin)/lots and /(liff)"
  ```
- **Why missed:** `(admin)` pages were added in Phase 2 (files dated 17:30) over Phase 1 `(liff)/lots` (09:40). Developer ran tsc+vitest only and explicitly skipped dev/curl ("QA hop"); neither tsc nor vitest exercises Next route-group resolution.
- **Fix direction (developer):** put admin screens under a real URL segment so they don't share `/` with LIFF, e.g. move `src/app/(admin)/*` to `src/app/admin/*` (real `admin/` segment -> `/admin/lots`, `/admin/orchards`, ...), and update the nav `<a href>` + login redirect paths in the admin pages accordingly. Keep `(liff)` browse at `/lots`. (API routes under `/api/**` are unaffected — they have no route-group collision.)

### Bug 2 (P1) — Created lot can never become buyable through the admin UI
- **Symptom:** AC4 fails for a lot created via the admin flow — after `qc RELEASE` it is `qcStatus=RELEASED` but `status=DRAFT`, so it never appears in `/api/liff/lots` and cannot be ordered.
- **Root cause:** `Lot.status @default(DRAFT)` (schema:94). `POST /api/admin/lots` accepts no `status` and does not set ACTIVE. `POST .../qc` only mutates `qcStatus`. The admin lots screen (`(admin)/lots/page.tsx`) has a create form + Release/Hold/Downgrade buttons but **no control to set status ACTIVE**. The only path to ACTIVE is `PATCH /api/admin/lots/{id} {status:"ACTIVE"}`, which the UI never calls. -> A lot born in the admin UI is permanently non-buyable even after release.
- **Repro (handler-level, reproduces the product gap):**
  ```
  POST /api/admin/lots {orchardId, fruitName, price, quantity}   -> 201, status=DRAFT qcStatus=PENDING
  POST /api/admin/lots/{id}/qc {action:"RELEASE"}                 -> 200, qcStatus=RELEASED, status STILL DRAFT
  GET  /api/liff/lots                                             -> lot ABSENT (present=false)
  ```
  Contrast (proves gate is otherwise correct): add `PATCH /api/admin/lots/{id} {status:"ACTIVE"}` between create and release -> lot then PRESENT in /api/liff/lots.
- **Fix direction (developer, pick one — design decision, flag to PM/TechLead):**
  a) RELEASE also sets `status=ACTIVE` in the qc transaction (couples QC release to listing), OR
  b) admin lots create defaults/accepts `status=ACTIVE`, OR
  c) add a status/activate control to the admin lots screen that PATCHes `status:"ACTIVE"`.
  Spec ambiguity: handoff defines buyable=`ACTIVE && RELEASED` and AC4="RELEASE -> present in liff/lots" but never says who flips ACTIVE. Needs a product/TechLead decision, hence documented not fixed.

## Cleanup (DB left clean for owner)
- Killed all `next dev`/`next-server` processes for this app (incl. stale PIDs 33815/33816 and my clean server on 3100). Left the unrelated port-3000 squatter (different app) alone.
- Removed every test row created: QA lots, QA orchards, QA orders (+items+payment), QA QcAudit, the AC2 scope row.
- Removed QA harness scripts (`qa-verify.ts`, `qa-verify2.ts`).
- Final sweep: QA lots 0, QA orchards 0, QA orders 0, `UserOrchardScope` total 0 (admin = ALL access), QcAudit total 0.
- `git status` shows only Phase 2 build artifacts (uncommitted) — no stray QA files.

## Verdict: NEEDS-FIX
Bug 1 (P0) blocks the entire app from running. Bug 2 (P1) breaks AC4 for the real admin workflow. The data/handler logic (RBAC, scope, QC audit trail, buyable gate, Phase 1 regression) is otherwise correct and verified.

## Handoff Request -> Developer (do NOT let QA fix)
1. **Bug 1 (P0):** resolve the `(admin)/lots` vs `(liff)/lots` route-group collision (recommend real `/admin/*` segment; update admin nav hrefs + login redirect). App must `npm run dev` and serve all routes 200 on a fresh boot.
2. **Bug 2 (P1):** decide + implement how a lot reaches `status=ACTIVE` so RELEASE -> buyable holds end-to-end (flag the design choice to PM/TechLead).
3. Re-verify by actually running dev + curl this time (not just tsc/vitest). Then re-QA.
