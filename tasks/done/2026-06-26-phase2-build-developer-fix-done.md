# Done: Phase 2 Developer fix — Bug 1 (route-group collision) + Bug 2 (admin lot activation)
Date: 2026-06-26 | Role: Developer | Stakes: durable | Verdict: FIXED

## Bug 1 (P0) — route-group collision -> namespaced admin under /admin/*
Moved all 5 admin pages from `(admin)/<x>/page.tsx` to `(admin)/admin/<x>/page.tsx` (kept in `(admin)` route group; now served at a real `/admin/*` URL segment, no longer sharing `/` with `(liff)`):
- `(admin)/login/page.tsx`    -> `(admin)/admin/login/page.tsx`    (/admin/login)
- `(admin)/orders/page.tsx`   -> `(admin)/admin/orders/page.tsx`   (/admin/orders)
- `(admin)/orchards/page.tsx` -> `(admin)/admin/orchards/page.tsx` (/admin/orchards)
- `(admin)/lots/page.tsx`     -> `(admin)/admin/lots/page.tsx`     (/admin/lots)
- `(admin)/buyers/page.tsx`   -> `(admin)/admin/buyers/page.tsx`   (/admin/buyers)
- `(liff)/lots/page.tsx` left untouched -> still serves `/lots` (the LIFF buyer page). Collision gone.
- No `api/**` paths touched (already /api/admin/*). No middleware, no next.config redirects, no (admin) layout.tsx existed.

Reference updates (grepped first, all hits fixed):
- nav `<a href>` in orders/orchards/lots/buyers: `/orders /orchards /lots /buyers` -> `/admin/orders /admin/orchards /admin/lots /admin/buyers` (4 links x 4 pages).
- login-guard redirects in orders/orchards/lots/buyers: `router.push("/login")` -> `"/admin/login"`.
- login success redirect in admin/login: `router.push("/orders")` -> `"/admin/orders"`.
- Left LIFF redirects alone: `(liff)/otp` and `(liff)/welcome` still `push("/lots")` (correct — buyer browse).
- Post-fix grep: 0 stale admin hrefs, 0 stale `push("/login")`/`push("/orders")`.

## Bug 2 (P1) — admin-created lot can now be set ACTIVE (kept two-gate semantics)
- Confirmed `src/app/api/admin/lots/[id]/route.ts` PATCH already accepts and persists `status` (body type line 27 `status?: string`; write line 44 `...(body.status !== undefined ? { status: body.status as never } : {})`). No route change needed.
- Did NOT auto-set ACTIVE on QC release (qc route still only flips qcStatus). Two gates preserved (buyable = ACTIVE && RELEASED).
- `(admin)/admin/lots/page.tsx`: added `setStatus(lot, status)` -> PATCH `/api/admin/lots/{id}` `{status}`. Replaced the static status cell with a `<select>` (DRAFT/ACTIVE/SOLD_OUT/CANCELLED) + a quick "Activate" button shown when status !== ACTIVE. Table already showed both `status` and `qcStatus` columns; both gates now visible AND operator-controllable.

## Verification
- `npx next build` -> Compiled successfully in ~1.6s, TypeScript pass, 26/26 pages generated, BUILD_EXIT=0. Route table proves the fix:
  ```
  ├ ○ /admin/buyers
  ├ ○ /admin/login
  ├ ○ /admin/lots
  ├ ○ /admin/orchards
  ├ ○ /admin/orders
  ...
  ├ ○ /lots          <- LIFF buyer page, distinct path
  ```
  No "two parallel pages that resolve to the same path" error. Bug 1 build-time collision is gone.
- `npx tsc --noEmit` -> 0 errors (TSC_EXIT=0). (First run showed stale `.next/dev/types/validator.ts` referencing OLD paths — a leftover artifact from the pre-move dev server; `rm -rf .next` + fresh build regenerated it, then tsc clean.)
- `npx vitest run` -> 25 passed | 7 skipped (6 files passed, 2 skipped: qc.integration + integration gated on LIVE_DB). Green, same baseline as QA.
- lots PATCH persists status: confirmed by reading the route (accepts `status`, writes it in the $transaction). UI now exercises it.

## Constraints honored
- No commit. No `.env` edits. No live DB migrations (schema.prisma unchanged by me; the M on schema/seed/migration_lock are pre-existing Phase 2 build artifacts, untouched). No dev server left running (verified `pgrep next dev/next-server` -> none).

## Files moved (git mv where tracked, mv for untracked artifacts)
- 5 admin page.tsx moved under `(admin)/admin/`.
## Files changed
- `(admin)/admin/login/page.tsx`    — login success redirect -> /admin/orders
- `(admin)/admin/orders/page.tsx`   — nav hrefs + login-guard redirect
- `(admin)/admin/orchards/page.tsx` — nav hrefs + login-guard redirect
- `(admin)/admin/buyers/page.tsx`   — nav hrefs + login-guard redirect
- `(admin)/admin/lots/page.tsx`     — nav hrefs + login-guard redirect + setStatus() + status <select>/Activate control (Bug 2)
