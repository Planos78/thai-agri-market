# Developer: Phase 6 — finish + verify (Expo native surface + packing/manifest + claim intake/triage)
Date: 2026-06-27 | Role: developer | Stakes: durable
Picked up an interrupted P6 build: prior run did most of the work, then a session limit hit BEFORE tests, the last 2 mobile screens, gate verification, and this report.

## What the prior run already did (verified, not recreated)
- Migration `prisma/migrations/20260627000000_phase6/migration.sql` (applied; `prisma migrate status` = up to date).
- Schema: `PackingManifest`, `PackingItem`, `ManifestImage`, `Claim`, `ClaimImage`, `ClaimEvent` + enums `PackingStatus/ClaimCategory/ClaimSeverity/ClaimStatus` + back-rels (`Order.packingManifest/claims`, `OrderItem.packingItems`, `User.claims`, `Refund.claimId @unique`).
- Libs: `lib/packing.ts` (pure reconcile/canSignOff), `lib/packing-tx.ts` (createManifest/setPackedQtys/signOffManifest), `lib/claim.ts` (pure transition table), `lib/claim-tx.ts` (fileClaim/triageClaim/resolveClaim), `lib/settlement-tx.ts` `createRefundInTx` (claimId-aware), `lib/storage.ts`.
- API routes: `api/admin/orders/[id]/packing`, `api/admin/packing/[id]{,/items,/images,/signoff}`, `api/admin/claims{,/[id]{,/triage,/resolve}}`, `api/shop/orders`, `api/{liff,shop}/order/[id]/claim{,/[cid]/images}`, `api/shop/otp/check` (token-in-body edit).
- Admin screens `(admin)/admin/{packing,claims}`; seed perms `packing.{read,write}` + `claims.{read,write}` on full-admin role.
- Mobile (4 of 6 screens): `app/{_layout,index,cart,auth/phone,auth/otp}.tsx`, `src/api/{client,types}.ts`, `src/cart/CartContext.tsx`. `app.json` scheme + `package.json main=expo-router/entry`.

## What I finished this run
1. **Mobile deps (blocker the prior run left)**: `expo-router`, `expo-secure-store`, `react-native-safe-area-context`, `react-native-screens` were referenced in code + `package.json main` but NOT in deps and NOT installed. Ran `npx expo install` (SDK56-compatible) -> added to `apps/mobile/package.json`; node_modules hoisted to workspace root. Without this the mobile typecheck/export could not run.
2. **2 missing mobile screens (-> 6 total)**: `app/order/[id].tsx` (order detail + pay/status via `POST /api/shop/order/[id]/payment`), `app/orders.tsx` (history via `GET /api/shop/orders`). Navigation was already wired in `_layout.tsx` + `index.tsx` links + `cart.tsx` push; both screens reuse the existing `api` client + match the StyleSheet/Thai-label pattern of the existing screens.
3. **P6 tests (none existed)**:
   - Unit `src/lib/__tests__/packing.test.ts` (8): reconcile equal->RECONCILED/no-variance, mismatch+over-pack->VARIANCE/hasVariance, counts sum, empty; signoff blocked from OPEN (409)/already-signed (409), VARIANCE requires non-empty note (422; whitespace-only rejected).
   - Unit `src/lib/__tests__/claim.test.ts` (10): full transition table valid+invalid, terminal locks (no exit from RESOLVED/REJECTED), assertTransition codes (terminal/illegal=409).
   - Integration `src/lib/__tests__/phase6.integration.test.ts` (5, LIVE_DB-gated, mirrors settlement.integration pattern): packing reconcile flags mismatch + signoff gate (OPEN 409 / VARIANCE-no-note 422 / note->SIGNED_OFF) + exact-match->RECONCILED; file claim writes Claim(OPEN)+FILE event+ClaimImage URL row (no binary); triage OPEN->TRIAGING then RESOLVED+createRefund -> linked Refund (claimId set, payoutType CUSTOMER, PENDING, amount 360, reachable via back-relation), terminal re-resolve 409; over-refund 422 leaves claim TRIAGING + 0 refunds (atomic).
   - Claim->refund linkage assertion lives in the integration suite (not a pure unit) because `resolveClaim`+`createRefundInTx` are DB-bound; a unit test could not really assert the Refund row.

## Bug I fixed in the prior run's P6 code (real, caught by LIVE_DB)
`lib/claim-tx.ts` `resolveClaim`: the claim status update + ClaimEvent were written FIRST, then `createRefundInTx` could `return err(...)` (over-refund / dup). Prisma's interactive `$transaction` only rolls back on a **throw** — returning an error object **commits**. So an over-refund left the claim RESOLVED with no refund (violates ACs #7 "atomically" / #8 "no half-writes"). Fix (minimal): throw a tagged `ClaimTxAbort(error,status)` when the in-tx refund fails so the whole tx rolls back, caught outside and converted back to the `{error,status}` shape. Verified: over-refund test now leaves claim TRIAGING + 0 refunds. (Also fixed test data: refund `approvedBy` must be a real `AdminUser.id` — used the seed admin id, not a literal — Refund.approvedBy is an FK to AdminUser.)

## Migration status
Applied. `prisma migrate status` -> "Database schema is up to date!" (6 migrations). `prisma generate` exit 0.

## Verify results
**apps/web**
- `npx prisma generate` -> exit 0.
- `npx tsc --noEmit` -> 0 errors (covers prior run's untested routes/screens + new tests).
- `npx vitest run` -> 96 passed | 39 skipped (DB-gated), incl. packing(8)+claim(10).
- `npx next build` -> exit 0, compiled successfully, no route collision. All P6 routes registered: `/admin/{packing,claims}`, `/admin/{packing,claims}/[id]`, `/api/admin/packing/[id]/{items,images,signoff}`, `/api/admin/claims/[id]/{triage,resolve}`, `/api/admin/orders/[id]/packing`, `/api/shop/orders`, `/api/{liff,shop}/order/[id]/claim{,/[cid]/images}`. (1 pre-existing Turbopack NFT-trace warning on next.config.ts/storage fs use — not a P6 regression.)
- LIVE_DB: `set -a && . ./.env && set +a && LIVE_DB=1 npx vitest run` -> 127 passed | 8 skipped (8 need external PSP/S3 creds, not DB). Full P3/P5/P6 green, no regression from the claim-tx fix. P6 integration alone: 5/5 pass.

**apps/mobile**
- `npx tsc --noEmit` -> 0 errors.
- `npx expo export --platform ios` -> exit 0; bundle `dist/_expo/static/js/ios/*.hbc` (2.5MB) + `dist/{assets,metadata.json}` produced.
- Honest device limit: no simulator/device E2E in this env (no clicking through native screens). Verification = typecheck + bundle export. Manual smoke step for QA: `EXPO_PUBLIC_API_URL=<dev-host> npx expo start`, scan QR, run phone-OTP -> browse -> cart -> order -> pay -> history.

## Claim -> Refund linkage note
On `resolveClaim(decision=RESOLVED, createRefund:true)`, inside ONE `$transaction`: assert transition -> update claim -> write ClaimEvent -> `createRefundInTx({ orderId, kind, amount, payoutType:'CUSTOMER', approvedBy:actor, claimId })`. `Refund.claimId` is the 1:1 link (`@unique`); refund is PENDING and still flows the P5 lifecycle (approve -> mock PSP callback). Dup-refund -> 409; over-refund -> 422; any in-tx refund error throws -> full rollback (claim NOT advanced). Verified against live DB.

## Files new this run
- apps/mobile/app/order/[id].tsx
- apps/mobile/app/orders.tsx
- apps/web/src/lib/__tests__/packing.test.ts
- apps/web/src/lib/__tests__/claim.test.ts
- apps/web/src/lib/__tests__/phase6.integration.test.ts

## Files modified this run
- apps/mobile/package.json (+ expo-router, expo-secure-store, react-native-safe-area-context, react-native-screens) + lockfile/node_modules via expo install
- apps/web/src/lib/claim-tx.ts (atomicity fix: throw-to-rollback on in-tx refund error)

## Not committed (per instructions). .env untouched.
