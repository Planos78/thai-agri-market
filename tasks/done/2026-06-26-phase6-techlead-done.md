# Tech Lead: Phase 6 — Expo native surface + ops consoles (packing/manifest + claim intake/triage)
Date: 2026-06-26 | Role: tech-lead | Stakes: durable | Spec only (no feature code)

Grounded in: roadmap §1/§2/§4/§7.2/§8/§11.2; `apps/mobile` scaffold; `apps/web` schema + `api/{liff,shop,admin,interface}/**`; `lib/{auth,storage,rbac,fulfillment-tx,settlement-tx,money,order-create}.ts`; seed perms. `prisma validate` on the P6 deltas PASSED.

---

## 0. Current-state findings (what exists, what to reuse)
- **`apps/mobile`** = bare Expo scaffold only: `App.tsx`, `index.ts`, `app.json`, `tsconfig.json`, assets. **No expo-router, no `app/` dir, no API client, no nav.** Versions: `expo ~56.0.11`, `react-native 0.85.3`, `react 19.2.3`, `typescript ~6.0.3`. => P6 must **bootstrap** the app from near-zero.
- **Buyer JSON API already exists and is reusable** (do NOT add new buyer order/pay endpoints): `GET api/shop/lots`, `POST api/shop/otp`, `POST api/shop/otp/check`, `POST api/shop/order`, `POST api/shop/order/[id]/payment`, plus `GET api/liff/orders` (history). LIFF history reads from `lineUserId`; shop order-create upserts a buyer `User` by `<phone>@shop.local`.
- **Auth model for mobile = phone-OTP (shop path)**, NOT LINE. LINE LIFF auth needs the in-browser LIFF SDK ID token (`getLine().verifyIdToken`) which Expo cannot mint without real LINE creds — out of scope per convention. Shop OTP is mock-gated (`SMS_PROVIDER=mock` returns `devOtp`).
- **GAP (one buyer-side gap, must fix):** `POST api/shop/otp/check` mints the session as an **httpOnly cookie** (`shop_session`) and only returns `{verified, phone}`. Mobile (no cookie jar in RN fetch by default; cross-origin dev) needs the **token in the JSON body**. Fix is additive + backward-compatible: also return `token` in the body; accept it as `Authorization: Bearer <token>` in `shopSessionFromRequest`. No new endpoint.
- **Money/tx/storage/rbac patterns to reuse verbatim:** `prisma.$transaction` for every money/state mutation (`fulfillment-tx.ts`, `settlement-tx.ts`); `getStorage().putImage()` -> URL only (bug #7); `requirePerm(req, perm)` Bearer-JWT gate + `scopedOrchardIds`; order-no scheme via `generateOrderNo(tx, prefix)` (prefixes already: S, PB, RF, IP). Refund creation/approval = `createRefund`/`approveRefund` in `settlement-tx.ts`, `refund.write` human-only, mock PSP, stays PENDING until callback.
- **Next.js 16.2.9 caveat (`AGENTS.md`):** read `node_modules/next/dist/docs/` before writing route handlers; **route `params` is a Promise** (`{ params }: { params: Promise<{ id: string }> }`, `await params`) — every P6 dynamic route follows this (matches existing admin routes).

---

## 1. Expo native buyer surface (apps/mobile) — MINIMAL viable

### Decisions
- **Auth:** phone-OTP via `api/shop/otp` + `api/shop/otp/check`; persist returned `token` in `expo-secure-store`; send `Authorization: Bearer <token>` on order/history calls. No LINE, no Apple sign-in, no real creds to build/typecheck.
- **Routing:** `expo-router` (file-based; idiomatic for SDK 56). Add deps: `expo-router`, `expo-secure-store`, `expo-constants`, `react-native-safe-area-context`, `react-native-screens`. Switch `package.json` `main` to `expo-router/entry`; add `scheme` to `app.json`.
- **API client:** `apps/mobile/src/api/client.ts` — typed `fetch` wrapper; base URL from `process.env.EXPO_PUBLIC_API_URL` (default `http://localhost:3000`); injects bearer from secure-store; shared response types in `apps/mobile/src/api/types.ts` (hand-mirrored from web JSON shapes — no build-time import across apps).
- **State:** local React state + a tiny cart context; no Redux. **Payment = mock-status only** (call `api/shop/order/[id]/payment`, render returned amount + status; "Mark paid (dev)" calls the existing mock PSP path; no real gateway in-app).

### Screens (file -> endpoint)
| Route file | Screen | Endpoint(s) |
|---|---|---|
| `app/index.tsx` | Browse lots | `GET /api/shop/lots` |
| `app/auth/phone.tsx` | Enter phone -> request OTP | `POST /api/shop/otp` |
| `app/auth/otp.tsx` | Enter OTP -> store token | `POST /api/shop/otp/check` |
| `app/cart.tsx` | Cart -> create order (gated on session) | `POST /api/shop/order` |
| `app/order/[id].tsx` | Order detail + pay/status | `POST /api/shop/order/[id]/payment` |
| `app/orders.tsx` | Order history | `GET /api/liff/orders` (reuse) or `GET /api/shop/orders` if added (see note) |

Note: shop has no `orders` history route today; LIFF history keys off `lineUserId` (null for shop buyers). **Smallest fix:** add `GET api/shop/orders` (Bearer shop session -> orders for the phone's buyer User). Spec it as the only *new buyer endpoint* (history), justified by a real gap. Everything else reuses existing routes.

### Out of scope (mobile): reschedule/adjust/review/claim-file screens (web/LIFF cover these in P3-P5); push notifications; deep links beyond auth return.

---

## 2. Packing / manifest console (Flow 6) — NEW, human-gated
Count/label reconcile BEFORE handoff to logistics. One manifest per order. `expectedQty` seeded from `OrderItem.quantity`; ops enters `packedQty`; variance flagged; **human sign-off required**.

**Reconcile rule (pure fn `lib/packing.ts`):**
- `expectedCount = sum(expectedQty)`, `packedCount = sum(packedQty)` across items.
- `hasVariance = any(packedQty != expectedQty)`.
- Status machine: `OPEN` -(reconcile)-> `RECONCILED` (no variance) **or** `VARIANCE` (mismatch) -(human sign-off)-> `SIGNED_OFF`.
- **Block:** cannot move to `SIGNED_OFF` from `OPEN`; a `VARIANCE` manifest **can** be signed off only with a non-empty `note` (human override, audited). Signing off flips/creates `Delivery` readiness — does NOT auto-handoff (logistics is a separate human step).
- Mutations human-only (`packing.write`); AI may compute/flag variance, never sign off.

Schema: `PackingManifest` (orderId @unique, deliveryId @unique?, status, expectedCount, packedCount, hasVariance, packedBy, packedAt, signedOffBy, signedOffAt, note) + `PackingItem` (manifestId, orderItemId, expectedQty, packedQty, `@@unique([manifestId, orderItemId])`) + `ManifestImage` (URL-only, storage adapter). Console page `app/(admin)/admin/packing/**`.

---

## 3. Claim intake + triage (Flow 7) — NEW, human-gated
Buyer files claim w/ evidence images -> AI/ops **classify + flag** (allowed) -> human triage decision (RESOLVED/REJECTED/ESCALATED — **human-only**, food-safety escalation). Resolution may **create a refund** (reuse P5 `createRefund`, human-approved).

**State machine (`lib/claim.ts`, pure transition table):**
- `OPEN` -> `TRIAGING` (ops picks up) | `REJECTED` (invalid).
- `TRIAGING` -> `RESOLVED` (optionally + refund) | `REJECTED` | `ESCALATED` (food-safety).
- `ESCALATED` -> `RESOLVED` | `REJECTED`.
- Terminal: `RESOLVED`, `REJECTED`. No transition out of terminal (409).
- **Human-only guard:** every transition except buyer-file (creates `OPEN`) requires `claims.write` (Bearer admin JWT). AI may set `aiFlag`/`category`/`severity` suggestion only; cannot transition.
- Every transition writes a `ClaimEvent` (action, fromStatus, toStatus, actor, note) in the same `$transaction`.

**Claim -> Refund linkage:** on `RESOLVED` with `createRefund:true`, inside one `$tx`: call `createRefund({ orderId, kind, amount, payoutType:'CUSTOMER', approvedBy })`, link `Refund.claimId` (1:1 `@unique`). Refund still flows the P5 lifecycle (PENDING -> approve -> mock PSP callback). Claim does NOT move money itself.

Schema: `Claim` (claimNo @unique prefix `CL`, orderId, buyerId?, lineUserId?, category enum, severity enum, description, status enum, aiFlag?, resolvedBy?, resolvedAt?) + `ClaimImage` (URL-only) + `ClaimEvent` (audit) + `Refund.claimId @unique` back-relation. Console `app/(admin)/admin/claims/**`.

---

## 4. Schema deltas (Prisma 7) — `prisma validate` PASSED
New models: `PackingManifest`, `PackingItem`, `ManifestImage`, `Claim`, `ClaimImage`, `ClaimEvent`. New enums: `PackingStatus{OPEN,RECONCILED,VARIANCE,SIGNED_OFF}`, `ClaimCategory{DAMAGED,QUALITY,MISSING,OTHER}`, `ClaimSeverity{LOW,MEDIUM,HIGH}`, `ClaimStatus{OPEN,TRIAGING,RESOLVED,REJECTED,ESCALATED}`.

Back-relations to ADD on existing models (exact):
- `Order`: `packingManifest PackingManifest?` + `claims Claim[]`
- `OrderItem`: `packingItems PackingItem[]`
- `User`: `claims Claim[]`
- `Refund`: `claimId String? @unique` + `claim Claim? @relation(fields:[claimId], references:[id])`

Validated copy: `/private/tmp/p6-schema.prisma` (temp; reproduce by appending the P6 block + the 4 back-relations to `prisma/schema.prisma` then `npx prisma validate`). Output: "The schema is valid".

---

## 5. Route contracts (admin + buyer). All dynamic routes use `params: Promise<...>` + `await params`.
| Route | Method | Auth | Body | Response | Codes | $tx |
|---|---|---|---|---|---|---|
| `api/shop/otp/check` (EDIT) | POST | none | `{reference,otp}` | `{verified,phone,token}` (add token) | 200/400 | no |
| `api/shop/orders` (NEW) | GET | Bearer shop session | — | `{orders}` for session phone | 200/403 | no |
| `api/admin/orders/[id]/packing` | POST | `packing.write` | — (init from OrderItems) | `{manifest}` | 201/403/404/409 | yes |
| `api/admin/packing/[id]` | GET | `packing.read` | — | `{manifest,items,images}` | 200/403/404 | no |
| `api/admin/packing/[id]/items` | PATCH | `packing.write` | `{items:[{orderItemId,packedQty}]}` | `{manifest}` recomputed | 200/403/404/422 | yes |
| `api/admin/packing/[id]/images` | POST | `packing.write` | multipart file | `{image:{url}}` (storage adapter) | 201/403/404 | no |
| `api/admin/packing/[id]/signoff` | POST | `packing.write` | `{note?}` (note required if variance) | `{manifest}` SIGNED_OFF | 200/403/404/409/422 | yes |
| `api/liff/order/[id]/claim` | POST | verified-LINE | `{category,description}` | `{claim}` OPEN | 201/401/404/422 | yes |
| `api/shop/order/[id]/claim` | POST | Bearer shop session | `{category,description}` | `{claim}` OPEN | 201/403/404/422 | yes |
| `api/liff/order/[id]/claim/[cid]/images` / shop equiv | POST | buyer (owns order) | multipart file | `{image:{url}}` | 201/403/404 | no |
| `api/admin/claims` | GET | `claims.read` | `?status&orderId` | `{claims}` | 200/403 | no |
| `api/admin/claims/[id]` | GET | `claims.read` | — | `{claim,images,events}` | 200/403/404 | no |
| `api/admin/claims/[id]/triage` | POST | `claims.write` | `{action:'TRIAGE'|'CLASSIFY',category?,severity?,aiFlag?,note?}` | `{claim,event}` | 200/403/404/409 | yes |
| `api/admin/claims/[id]/resolve` | POST | `claims.write` | `{decision:'RESOLVED'|'REJECTED'|'ESCALATED',note?,createRefund?,refundKind?,refundAmount?}` | `{claim,event,refund?}` | 200/403/404/409/422 | yes |

Evidence images: all via `getStorage().putImage()` -> persist `url` only (`ManifestImage`/`ClaimImage`).

---

## 6. RBAC perms (seed `prisma/seed.ts` perm list + admin role)
ADD: `["packing.read","Read packing manifests"]`, `["packing.write","Write packing + sign-off"]`, `["claims.read","Read claims"]`, `["claims.write","Triage + resolve claims"]`. Grant all four to the seeded full-admin role (same upsert loop as existing perms).

---

## 7. Test plan
**Unit (`lib/__tests__/`):**
- `packing.test.ts` — reconcile: equal qty -> RECONCILED/no variance; mismatch -> VARIANCE/`hasVariance`; counts sum correctly; signoff blocked from OPEN; VARIANCE signoff requires note.
- `claim.test.ts` — full state-machine transition table incl. illegal transitions (terminal -> X = reject); **human-only guard** (buyer can only create OPEN; transitions require admin perm); ClaimEvent emitted per transition.
- `claim-refund.test.ts` — RESOLVED + createRefund creates a `Refund` linked via `claimId`, with `payoutType=CUSTOMER`, status PENDING; refund amount validation (over-refund 422).
**Integration (LIVE_DB-gated, `*.integration.test.ts`, skip when no `DATABASE_URL`):**
- File claim writes `Claim` + `ClaimImage` rows (storage local adapter).
- Triage/resolve transitions persist + write `ClaimEvent`; resolve-with-refund writes linked `Refund` atomically (assert all-or-nothing).
- Packing reconcile flags mismatch; signoff requires note on variance.
**Expo app:** `cd apps/mobile && npx tsc --noEmit` (typecheck) + `npx expo export` (bundle build) in CI. **Honest limit:** no device/simulator E2E in this environment — QA cannot click through native screens here. Smoke = typecheck + bundle + a documented manual run (`EXPO_PUBLIC_API_URL=<dev> npx expo start`, scan QR) listed as a manual QA step, not automated.

---

## 8. Migration
`cd apps/web && npx prisma migrate dev --name phase6` (DIRECT_URL via `prisma.config.ts`; datasource block untouched). Fallback if shadow-DB/network blocks: `prisma migrate diff --from-schema-datasource ... --to-schema-datamodel prisma/schema.prisma --script > migrations/<ts>_phase6/migration.sql` -> `prisma db execute --file ...` -> `prisma migrate resolve --applied <ts>_phase6`. Then `npx prisma generate`. Re-seed perms (`npx prisma db seed`).

---

## 9. Acceptance criteria (numbered, testable)
**(a) Web/API/ops — QA can curl:**
1. `prisma validate` + `migrate dev --name phase6` succeed; 6 new models + 4 enums present; perms `packing.*`/`claims.*` seeded onto admin role.
2. `POST api/admin/orders/[id]/packing` (packing.write) creates a manifest with `PackingItem` rows seeded from OrderItems; missing perm -> 403; unknown order -> 404.
3. `PATCH .../packing/[id]/items` with a mismatch sets `hasVariance=true`, status `VARIANCE`; exact match -> `RECONCILED`.
4. `POST .../packing/[id]/signoff` from OPEN -> 409; from VARIANCE without note -> 422; with note -> `SIGNED_OFF` + `signedOffBy/At` set.
5. Buyer files a claim (verified-LINE or shop session) -> `OPEN` `Claim` persisted; evidence image upload stores a URL row, no binary in DB.
6. `claims/[id]/triage` (claims.write) sets category/severity/aiFlag + writes a ClaimEvent; non-admin -> 403.
7. `claims/[id]/resolve` enforces the state machine (terminal -> X = 409); RESOLVED + `createRefund:true` creates a `Refund` linked by `claimId` (payoutType CUSTOMER, PENDING) atomically; over-refund -> 422.
8. All money/state mutations run inside `prisma.$transaction` (no half-writes on forced failure).
**(b) Expo app — realistic build-level only:**
9. `apps/mobile` typechecks (`tsc --noEmit`) and bundles (`expo export`) with expo-router + the 6 screens + api client present.
10. API client reads `EXPO_PUBLIC_API_URL`; auth flow stores the token from `otp/check` in secure-store and sends it as Bearer on order/history calls (verified by unit test of the client, since no simulator E2E). Documented manual smoke step provided; QA cannot device-verify in this environment.

---

## Alternatives Considered
1. Mobile auth via LINE LIFF ID token (reuse `verify-line`). Trade-off: matches LIFF identity but needs the in-browser LIFF SDK + real LINE creds Expo can't mint offline -> blocks build/typecheck. Rejected.
2. Mobile reuses cookie session as-is. Trade-off: zero API change but RN fetch has no shared cookie jar / cross-origin dev pain -> fragile. Rejected.
3. **Chosen — phone-OTP shop path + token-in-body (Bearer).** Why: smallest additive API change, fully mock-gated, no external creds, reuses all existing order/pay logic.

KISS gate: claim and packing are separate concerns with separate state machines — not merged into one "ops event" table (would muddy food-safety audit). Manifest is 1:1 with Order (no batching) for pilot scale. Both answered "is there a simpler way? — no, this is the floor."

## Cross-cutting scan
- Security: buyer claim/packing-image routes must verify the buyer owns the order; admin routes Bearer-JWT + perm. Storage `safeName` already strips traversal. => security-reviewer on the developer PR.
- Compliance/food-safety: claim ESCALATED + resolution refund are human-only (roadmap §4 boundary) — encoded as no-auto-approve path.
- Observability: ClaimEvent + PackingManifest signoff fields are the audit trail.
- Cost/i18n/Scale: no new external vendor; manifest/claim volumes small at pilot. No new owners triggered beyond security-reviewer.
