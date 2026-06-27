# QA: Phase 6 — Expo native + ops (packing/manifest + claim intake/triage)
Date: 2026-06-27 | Role: QA | Verdict: SHIP (web/API/ops fully verified; Expo = build-level verified, device E2E out of scope by design)
Independent, adversarial re-run. Trusted nothing: re-ran all gates, drove every web/API/ops AC through the real HTTP routes + RBAC, and proved the money-critical atomicity rollback by direct DB inspection (not just the dev's vitest).

Cost note: PostToolUse hook flagged session cost $98.91 repeatedly; brief authorized "do not pause for cost"; continued as instructed.

---

## Gates (re-run by QA)
**apps/web** (Node 25, Next 16.2.9, Prisma 7.8, vitest 2.1.9)
- `npx tsc --noEmit` -> exit 0, 0 errors.
- `npx vitest run` (no DB) -> 96 passed | 39 skipped (15 files pass, 6 DB-gated skipped). packing(8) + claim(10) present + green.
- `npx next build` -> exit 0, "Compiled successfully", no route collision. All P6 routes registered: `/admin/{packing,claims}` + `/admin/{packing,claims}/[id]`; `/api/admin/orders/[id]/packing`; `/api/admin/packing/[id]{,/items,/images,/signoff}`; `/api/admin/claims`, `/api/admin/claims/[id]{,/triage,/resolve}`; `/api/{liff,shop}/order/[id]/claim{,/[cid]/images}`; `/api/shop/orders`.
- LIVE_DB (`set -a && . ./.env && set +a && LIVE_DB=1 npx vitest run`) -> **127 passed | 8 skipped** (8 = external PSP/S3 creds, not DB). P6 integration suite alone: 5/5 pass. P3/P4/P5 regression suites all green. Counts match the dev report exactly.

**apps/mobile** (Expo SDK 56, expo-router)
- `npx tsc --noEmit` -> exit 0, 0 errors.
- `npx expo export --platform ios` -> exit 0; iOS Hermes bundle `dist/_expo/static/js/ios/*.hbc` (2.5MB) + assets + metadata.json produced.
- 6 screens present: `app/index.tsx`, `app/auth/phone.tsx`, `app/auth/otp.tsx`, `app/cart.tsx`, `app/order/[id].tsx`, `app/orders.tsx` (+ `_layout.tsx`). API client `src/api/{client,types}.ts` + `src/cart/CartContext.tsx` present. Deps installed (expo-router, expo-secure-store, react-native-safe-area-context/screens; `main=expo-router/entry`).
- **Honest Expo limit:** NO device/simulator E2E in this environment. Verified = typecheck + bundle export only. Cannot click through native screens, cannot confirm the secure-store Bearer flow on a real device. The Bearer-token path itself WAS proven server-side (see AC10).

---

## AC verification (web/API/ops — driven through real HTTP routes on a fresh dev server, port 3100; 3000 was Docker)
Setup: real flow = shop OTP -> otp/check (token-in-body) -> create order (Bearer) -> dev/mock-pay (signed PSP callback) -> PAID order S260627045, total 1800. Tokens minted with jose (same lib/secret as app): a full-perm token, a zero-perm token (valid JWT), and a token whose `sub` = real seeded AdminUser.id (needed because `Refund.approvedBy` FKs AdminUser via `claims.sub`).

| AC | Check | Result | Evidence |
|---|---|---|---|
| 1 | Migration applied; 6 models + 4 enums; perms seeded | PASS | `prisma migrate status` up to date (dev report); seed grants packing.{read,write}+claims.{read,write} to admin role (15 permissions total live) |
| 2 | Create manifest seeds PackingItems from OrderItems; perm gate; unknown order | **PARTIAL** | full-perm -> 201, status OPEN, expectedCount 10, items=1. no token -> 401, no perm -> 403, dup -> 409. **Unknown order -> 403, NOT the AC-specified 404** (see Bug 1) |
| 3 | PATCH mismatch -> VARIANCE/hasVariance; exact -> RECONCILED | PASS | short pack 8/10 -> 200, status VARIANCE, hasVariance=true, packedCount=8. exact-match -> RECONCILED proven in LIVE_DB integration |
| 4 | Signoff OPEN->409; VARIANCE no-note->422; with note->SIGNED_OFF | PASS | OPEN -> 409; no-note -> 422; with note -> 200 SIGNED_OFF, signedOffBy set (token sub) |
| 5 | Buyer files claim -> OPEN; image stores URL row, no binary | PASS | shop-session file -> 201, OPEN, claimNo CL260627016. no session -> 403 (ownership). image upload -> 201; admin GET shows images=1; DB confirms ClaimImage row, no binary |
| 6 | Triage sets category/severity/aiFlag + ClaimEvent; non-admin 403 | PASS | TRIAGE OPEN->TRIAGING 200 (severity HIGH, event.action=TRIAGE). CLASSIFY = suggestion-only, no transition (stays TRIAGING). no perm -> 403, no token -> 401 |
| 7 | State machine (terminal->409); RESOLVED+refund linked atomically; over-refund 422 | PASS | OPEN->RESOLVED (skip) -> 409. TRIAGING->TRIAGING -> 409. RESOLVED+refund 360 -> 200; Refund row claimId set (1:1), payoutType CUSTOMER, status PENDING, amount 360, reachable via `claim.refund` back-rel. Terminal RESOLVED->REJECTED/->TRIAGING -> 409. over-refund 999999 -> 422 |
| 8 | All money/state in $transaction; no half-writes on forced failure | **PASS (KEY REGRESSION PROVEN)** | see Atomicity Proof below |
| 9 | Mobile typechecks + bundles with expo-router + 6 screens + api client | PASS | tsc 0, expo export exit 0, all files present |
| 10 | API client reads EXPO_PUBLIC_API_URL; otp/check token -> Bearer on order/history | PASS (server-side) | The Bearer-token-in-body path (the P6 GAP fix) was proven server-side: order create + claim file + claim image upload all succeeded using `Authorization: Bearer <shop token>` from otp/check body. Device-side secure-store wiring NOT device-verified (no simulator) |

### Atomicity Proof (AC8 — the bug the dev fixed)
On a claim in TRIAGING, forced an over-refund via the real resolve route:
`POST /api/admin/claims/<id>/resolve {decision:RESOLVED, createRefund:true, refundAmount:999999}` -> **HTTP 422** "refund exceeds order total (over-refund)".
Then read the DB directly (app prisma via tsx):
- `claim.status = TRIAGING` (NOT advanced to RESOLVED)
- `resolvedBy = null`, `resolvedAt = null`
- `refund_count = 0` (no orphan/partial refund)
- ClaimEvents = `[FILE, TRIAGE, CLASSIFY]` only — **no RESOLVE event leaked**
=> `ROLLBACK_PROVEN = true`. The claim update + ClaimEvent written first inside the tx were rolled back by the `throw ClaimTxAbort` path in `lib/claim-tx.ts` (Prisma interactive tx only rolls back on throw; returning an error commits). Confirmed end-to-end through the route, not just the dev's vitest.

### Gate 0 (no real funds)
Refund created is PENDING via P5 createRefundInTx (CUSTOMER), mock PSP only. No real money moved.

### Regression (P1-P5)
- order -> mock-pay -> PAID: reproduced in my own HTTP flow (order S260627045 went PAID via signed callback). transferAmount set (BUG-A) verified by P5 LIVE_DB suite passing.
- payout happy-path eligible, over-refund impossible (BUG-B): P5 settlement LIVE_DB suite 11/11 green incl. concurrent-overlapping-refund + over-refund-422.
- admin /admin/* serve, liff/lots, webhook HMAC: next build registers all; webhook/hmac unit + integration green.
No regression from the claim-tx atomicity fix.

---

## Bugs found
**Bug 1 (MINOR / spec deviation, not blocking): unknown order on packing-create returns 403, not 404.**
- Repro: `POST /api/admin/orders/00000000-0000-0000-0000-000000000000/packing` with packing.write -> **403** (AC #2 specifies 404).
- Cause: `requireOrderScope(claims, id)` (src/lib/fulfillment-scope.ts:22) runs before `createManifest`. For a non-existent order, `orderOrchardIds` returns `[]`, and the `orchardIds.length === 0` branch returns 403 ("forbidden") before a 404 can be produced.
- Severity: cosmetic/security-posture. Returning 403 (don't leak existence) for an unknown id is defensible and `requireOrderScope` is reused across P4/P5 admin routes (consistent behavior). Not a money/state/security defect. Either (a) accept 403 and amend the AC text, or (b) probe order existence -> 404 before scope -> 403 if a precise 404 is required. Owner/tech-lead call; does not block ship.

No other bugs. The claim-tx atomicity fix is real and holds under independent HTTP+DB testing.

---

## Cleanup (done)
- Killed dev server on 3100. Docker on 3000 left untouched (verified still listening).
- Deleted ALL QA test rows: order S260627045 + its payment/items/claims(1)/claimImages(1)/claimEvents(4)/refunds(1)/packingManifest(1)/packingItems(1) + otpLogs + the synthetic shop buyer (0 remaining orders). Final sweep: orders/claims/packing/refunds/payments/otpLogs all = 0.
- Deleted ALL upload test images in apps/web/public/uploads (8 files: my run's + the LIVE_DB integration suite's evidence/proof images, which clean DB rows but not disk); kept .gitkeep.
- Orchard.rating = 0 (baseline, undisturbed; my flow filed no reviews).
- Removed apps/mobile/dist (expo export artifact). No stray QA scripts in repo. `.env` untouched.
- Final DB baseline: seed only (orchards 1, lots 3, adminUsers 1, permissions 15, users 7). No VITEST/QA residue. git status unchanged from the P6 build (no QA additions).

---

## What QA verified vs NOT for the Expo app
- VERIFIED: tsc 0 errors; `expo export` produces an iOS bundle; all 6 route screens + api client + cart context present; deps installed; the server-side Bearer-token contract the app depends on (otp/check returns token in body; order/claim accept Authorization: Bearer).
- NOT verified (out of scope, no device/simulator in this env): native navigation, on-device secure-store persistence, actual QR/Expo Go run, end-to-end tap-through (phone-OTP -> browse -> cart -> order -> pay -> history). Documented manual smoke step: `EXPO_PUBLIC_API_URL=<dev-host> npx expo start`, scan QR.
