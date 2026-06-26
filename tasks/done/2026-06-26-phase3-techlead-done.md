# Tech Lead: Phase 3 — LINE LIFF surface + messaging
Date: 2026-06-26 | Role: tech-lead | Stakes: durable | Project: apps/web

> TECH SPEC only. No feature code written. Grounded in roadmap §8(P3)/§7.2/§4/§6/§11.1 + live codebase inspection. Cross-cutting convention carried: vendors stay mock/sandbox, env-gated (mirror `psp.ts` + `dev/mock-pay`). Nothing goes live; respects Gate 0. Build code + adapters, not real integrations.

## 0. Codebase state vs roadmap (verified)
- P2 already shipped beyond the §9 snapshot: `AdminUser/AdminRole/Permission/AdminRolePermission`, `QcAudit`, `ConsentLog`, `UserOrchardScope`, full `Lot.qcStatus`, `PaymentCallbackLog` (FK to Order), `lib/rbac.ts`, `lib/auth.ts` (jose JWT + scrypt), `lib/order-no.ts` (FOR UPDATE), `lib/psp.ts` + `dev/mock-pay`, `lib/line.ts` (mock adapter, `relayPush`).
- `ConsentLog` exists (`lineUserId/purpose/granted/createdAt`) — P3 writes it, no schema change.
- `lib/line.ts` is **stub**: `MockLine.verifyIdToken` parses `mock:<id>[:<name>]`; `push` is `console.log`. No real JWKS verify, no retry. `relayPush` is in-process fire-and-forget = bug #5 still open.
- `internal/push/[event]` relays in-process (no PushJob, no retry) — bug #5.
- No webhook route, no `LineBotLog`/`LiffRequestLog`/`OrchardRegisterCode`/`PushJob` models, no order-history API/screen. These are the P3 deltas.
- Stack confirmed: Next 16.2.9, Prisma 7.8, `@prisma/adapter-pg`, jose, vitest. `params` is a Promise (see push route). Datasource block has NO url (adapter supplies it); migrations use `DIRECT_URL` via `prisma.config.ts` — do NOT edit datasource.

## 1. Schema deltas (prisma/schema.prisma) — back-relations so `prisma validate` passes
Append these models. Reuse existing enums where noted.

```prisma
// --- LINE staff binding (bug #10: FK to Orchard, not varchar) ---
model OrchardRegisterCode {
  id         String    @id @default(uuid())
  code       String    @unique
  orchardId  String
  redeemedAt DateTime?
  redeemedBy String?   // lineUserId that redeemed
  expiresAt  DateTime?
  createdAt  DateTime  @default(now())

  orchard Orchard @relation(fields: [orchardId], references: [id])
  @@index([orchardId])
}

// --- bind result: which LINE staff belong to which orchard (bug #4 detect "no binding") ---
model OrchardLineBinding {
  id         String   @id @default(uuid())
  orchardId  String
  lineUserId String
  createdAt  DateTime @default(now())

  orchard Orchard @relation(fields: [orchardId], references: [id])
  @@unique([orchardId, lineUserId])
  @@index([lineUserId])
}

// --- audit LIFF requests (roadmap §3.5 liff_request_logs) ---
model LiffRequestLog {
  id         String   @id @default(uuid())
  lineUserId String?
  path       String
  method     String
  status     Int
  createdAt  DateTime @default(now())
  @@index([lineUserId])
  @@index([createdAt])
}

// --- bot interaction log (roadmap §3.5 line_bot_logs); bug #6: state lives in DB, not memory ---
model LineBotLog {
  id          String   @id @default(uuid())
  lineUserId  String?
  eventType   String   // "message" | "follow" | "postback" | "unfollow" | ...
  replyToken  String?
  text        String?
  rawEvent    String   // JSON
  handled     Boolean  @default(false)
  createdAt   DateTime @default(now())
  @@index([lineUserId])
}

// --- push queue (bug #5 fix: push is NOT fire-and-forget) ---
model PushJob {
  id          String        @id @default(uuid())
  event       String
  lineUserId  String
  message     String
  status      PushStatus    @default(PENDING)
  attempts    Int           @default(0)
  maxAttempts Int           @default(3)
  lastError   String?
  nextAttemptAt DateTime    @default(now())
  sentAt      DateTime?
  createdAt   DateTime      @default(now())
  updatedAt   DateTime      @updatedAt
  @@index([status, nextAttemptAt])
  @@index([lineUserId])
}

enum PushStatus {
  PENDING
  SENT
  FAILED
}
```

Add back-relations to **existing** `Orchard` model (only edit there):
```prisma
  registerCodes OrchardRegisterCode[]
  lineBindings  OrchardLineBinding[]
```
- **NotiTopic/NotiSubscriber: DEFER** (roadmap §3.5 marks defer). Not trivial (needs broadcast UI + LINE multicast); zero P3 acceptance criteria depend on it. Recommendation = out of scope.
- `OrchardRegisterCode` deliberately split from `OrchardLineBinding`: code is single-redeem; bindings are many-staff-per-orchard. Keeping them separate makes bug #4 ("orchard has no LINE binding") a cheap `count` query.

## 2. LINE token verify — `lib/line.ts` extension (env-gated mock + real)
Extend the existing `LineAdapter`. Add a `LineRealAdapter` selected when creds present; keep `MockLine` default.

- **Mock mode (default, no creds):** unchanged `mock:<id>[:<name>]` parse. This is what every test + dev run uses.
- **Real mode:** `verifyIdToken` = POST `https://api.line.me/oauth2/v2.1/verify` with `id_token` + `client_id=LINE_CHANNEL_ID` (LINE's documented endpoint; simplest correct path, no manual JWKS). Validate `aud === LINE_CHANNEL_ID`, `iss === "https://access.line.me"`, `exp > now`. Return `{lineUserId: sub, name}`. Alternative (JWKS via jose `createRemoteJWKSet`) noted in §Alternatives.
- **Selector:** `getLine()` switches on `process.env.LINE_PROVIDER` (`"mock"` default, `"line"` real). Real path requires `LINE_CHANNEL_ID`; if absent while `LINE_PROVIDER=line`, throw at construction (fail loud, not silent mock).
- **Env vars:** `LINE_PROVIDER=mock|line`, `LINE_CHANNEL_ID`, `LINE_CHANNEL_SECRET` (webhook HMAC), `LINE_CHANNEL_ACCESS_TOKEN` (push). `INTERNAL_PUSH_SECRET` already used by push route.
- `api/liff/verify-line` route contract is unchanged (already correct) — it just gets a real verifier underneath.

## 3. Push with retry/queue (bug #5 fix)
**Chosen: enqueue + best-effort-attempt-inline + cron sweep retry.** Simplest correct fit for Vercel serverless (no long-lived process; roadmap §11.2).

- New `lib/push.ts`:
  - `enqueuePush(tx, {event, lineUserId, message})` — creates `PushJob` PENDING **inside the caller's `$transaction`** (so a push is never lost if the txn commits). Returns job id.
  - `attemptPush(jobId)` — loads job, calls `getLine().push()`, on success → `SENT/sentAt`; on throw → `attempts++`, `lastError`, `status=FAILED` if `attempts>=maxAttempts` else stays PENDING with `nextAttemptAt=now+backoff`. Wrapped so a throw never bubbles to the request.
  - `sweepPushJobs(limit)` — selects PENDING where `nextAttemptAt<=now` order by `nextAttemptAt`, calls `attemptPush` each. Called by cron (P7 wires Vercel Cron; P3 ships the function + a dev trigger).
- `relayPush(event,id,msg)` is **rewritten** to `enqueuePush`+`attemptPush` (no behavior change for callers; the payment-callback route keeps calling `relayPush` but now it is durable). Callers already inside a txn (callback route) should call `enqueuePush(tx,...)` directly so enqueue is atomic with the state flip, then `attemptPush` after commit.
- `internal/push/[event]` route: rewritten to `enqueuePush` (own short txn) then fire `attemptPush`, return `{ok, jobId, status}`.
- Why not a separate worker / queue service: no infra exists, serverless can't poll; a DB-table-as-queue swept by cron is the standard Vercel pattern and is testable without infra.

## 4. LINE webhook handler — `app/api/line/webhook/route.ts` (new)
- **Raw body first:** `const raw = await req.text();` then verify, then `JSON.parse(raw)`. Must NOT use `req.json()` (re-serialization breaks HMAC). Standard Web `Request`; same API the codebase already uses.
- **Signature:** `X-Line-Signature` = base64(HMAC-SHA256(channelSecret, rawBody)). Add `verifyLineSignature(raw, sig, secret)` to `lib/hmac.ts` (existing file is hex+constant-time; LINE needs base64 digest — new fn, reuse `crypto.timingSafeEqual`). Reject 401 before any DB access (mirror payment-callback AC4).
- **Mock mode:** when `LINE_CHANNEL_SECRET` absent → skip signature check (dev), still parse + log. Gate behind `LINE_PROVIDER==="mock"` so prod (`line`) always enforces.
- **Per event:** write `LineBotLog`. Handle:
  - `message` text matching a register-code pattern (e.g. `REG-XXXX`) → redeem flow (§4a).
  - `follow`/`unfollow` → log only (P3).
- **§4a register-code redeem (bug #10 FK, bug #4 warn):** in `$transaction`: load `OrchardRegisterCode` by code; reject if missing/redeemed/expired (reply error). Else set `redeemedAt/redeemedBy`, upsert `OrchardLineBinding(orchardId,lineUserId)`. After commit, enqueue a confirmation push. **Bug #4:** redeem makes the binding; the *register screen / admin orchard view* surfaces a visible warning when `OrchardLineBinding` count for an orchard is 0 (see §5 + §7).
- **Bug #6:** any multi-step bot state keyed by `lineUserId` is read/written via `LineBotLog`/binding rows — no module-level/in-memory map. Serverless has no persistent memory anyway.

## 5. LIFF journey screens (roadmap §7.2) — extend, keep P1 screens
Existing: `welcome, register, otp, lots, order/confirm, order/[id]/pay`. Add/extend:
- `(liff)/pdpa/page.tsx` (NEW) — PDPA consent screen between otp and ordering. POSTs `api/liff/consent` → writes `ConsentLog{lineUserId, purpose:"pdpa_marketing"|"pdpa_required", granted}`. Required consent blocks progression; flips `VerifiedLineUser.consent`.
- `(liff)/orders/page.tsx` (NEW) — order-history list for the verified caller. Calls `GET api/liff/orders?lineUserId=`.
- `register`/`otp` extended: after OTP success route through `pdpa` before `lots`. Register screen shows bug #4 warning copy only on the *staff* register path (orchard with no LINE binding) — buyer path unaffected.

## 6. Route contracts (new/changed). All money/state writes in `$transaction`. `params` is `Promise` for `[event]`.

| Route | Method | Auth/verify | Body / Query | 200 response | Codes | Prisma |
|---|---|---|---|---|---|---|
| `api/liff/verify-line` | POST | LINE ID token (real or mock) | `{idToken}` | `{lineUserId,name,verified}` | 200 / 401 bad token | `verifiedLineUser.findUnique`; +`liffRequestLog.create` |
| `api/liff/consent` (NEW) | POST | lineUserId must be verified | `{lineUserId,purpose,granted}` | `{ok,granted}` | 200 / 400 / 403 unverified | `$tx[ consentLog.create, verifiedLineUser.update ]` |
| `api/liff/orders` (NEW) | GET | lineUserId verified; **caller-scoped** | `?lineUserId=` | `{orders:[{orderNo,status,totalAmount,createdAt,items}]}` | 200 / 400 / 403 | `user.findUnique(lineUserId)` → `order.findMany({where:{buyerId}})` only |
| `api/internal/push/[event]` (CHANGED) | POST | `x-internal-secret` (optional) | `{lineUserId,message}` | `{ok,jobId,status}` | 200 / 400 / 403 | `$tx pushJob.create` then `attemptPush` |
| `api/line/webhook` (NEW) | POST | `X-Line-Signature` HMAC (mock-skip) | raw LINE event JSON | `{ok}` (always 200 to LINE on accepted sig) | 200 / 401 bad sig | per-event `lineBotLog.create`; redeem `$tx[registerCode.update, orchardLineBinding.upsert]` |
| `api/cron/push-sweep` (NEW) | POST/GET | `CRON_SECRET` header | — | `{swept,sent,failed}` | 200 / 403 | `sweepPushJobs` |
| `api/cron/expire-orders` (optional, §9) | POST | `CRON_SECRET` | — | `{expired}` | 200 / 403 | `$tx order.updateMany WAITING_PAYMENT past expiry → EXPIRED` |

`api/liff/order` (P1) unchanged but its post-create success notification should `enqueuePush` (durable) instead of nothing — minor, optional in P3.

## 7. Bug fixes (roadmap §11.1)
- **#4** orchard with no LINE binding: `OrchardLineBinding` count==0 → admin orchard detail + staff register screen render a visible warning ("ยังไม่มีการผูก LINE — จะไม่ได้รับการแจ้งเตือน"); push code that targets an unbound orchard records `PushJob` FAILED with `lastError="no line binding"` (not silent).
- **#5** push retry/queue: §3.
- **#6** no in-memory bot state: §4 (DB-backed).
- **#10** register code FK: `OrchardRegisterCode.orchardId` is a real FK (§1), never varchar.
- (carry) #11 already satisfied by existing FK on `PaymentCallbackLog`; new logs (`LineBotLog`, `PushJob`) keep `lineUserId` as plain string by design (LINE id is the external key, not an internal FK).

## 8. Test plan (vitest; mirror existing `__tests__` + `describe.skip` DB gating)
**Unit (DB-free, mock fns):**
- `hmac.test.ts` extend: `verifyLineSignature` accepts valid base64 sig, rejects tampered body / wrong secret / length mismatch.
- `push.test.ts` (NEW): state machine — PENDING→SENT on adapter success; PENDING→PENDING(+backoff) on transient fail; →FAILED at `maxAttempts`; `attemptPush` never throws.
- `webhook.test.ts` (NEW): register-code redeem logic — valid code binds + marks redeemed; already-redeemed/expired/missing rejected; unbound-orchard path flagged.
- `line.test.ts` (NEW): mock verifier parse; real adapter selector throws when `LINE_PROVIDER=line` and `LINE_CHANNEL_ID` missing.

**Integration (`describe.skip`, LIVE_DB-gated, same convention as `integration.test.ts`):**
- webhook rejects bad `X-Line-Signature` (401, no DB write).
- PushJob retry: enqueue → fail adapter → sweep → eventual SENT/FAILED, attempts increment.
- `api/liff/orders` returns only the caller's orders (seed two buyers, assert isolation).
- consent write persists `ConsentLog` + flips `VerifiedLineUser.consent`.

## 9. Migration (same as P2)
```
cd apps/web && npx prisma migrate dev --name phase3
```
Connection via `prisma.config.ts` → `DIRECT_URL` (do NOT touch datasource block). Fallback if `migrate dev` can't reach shadow DB:
```
npx prisma migrate diff --from-schema-datasource prisma/schema.prisma --to-schema-datamodel prisma/schema.prisma --script > prisma/migrations/phase3.sql
# apply via psql/execute, then:
npx prisma migrate resolve --applied phase3
```
Run `npx prisma validate` + `npx prisma generate` before coding routes.

## 10. Acceptance criteria (numbered, testable — for QA)
1. `verify-line` with a valid LINE ID token returns `{lineUserId, verified}`; mock mode accepts `mock:<id>`; real mode rejects a forged token (401).
2. Webhook with an invalid `X-Line-Signature` is rejected 401 with **zero** DB writes (mock mode may skip check only when `LINE_PROVIDER=mock`).
3. Webhook with valid signature writes exactly one `LineBotLog` per event.
4. Redeeming a valid register code binds the LINE user to the orchard (`OrchardLineBinding` row, FK intact) and marks the code `redeemedAt`; redeeming a used/expired/unknown code is rejected and creates no binding.
5. An orchard with zero LINE bindings shows a visible warning on register/admin and any push to it ends as `PushJob.FAILED` (never silently dropped) — bug #4.
6. A push enqueues a `PushJob`; on adapter failure it retries up to `maxAttempts` then is `FAILED`; on success it is `SENT` with `sentAt` — no fire-and-forget (bug #5).
7. `GET api/liff/orders` returns only the calling verified user's orders; another user's orders never appear.
8. PDPA consent screen writes a `ConsentLog` row and required-consent gates ordering.
9. `prisma validate` passes; `prisma migrate dev --name phase3` applies cleanly; `vitest run` green (unit) and skipped integration suite is present.
10. No route calls LINE directly except `lib/line.ts`; webhook + push verify/queue all flow through adapters; build/test pass with **no real LINE creds** (env-gated mock).

## Alternatives Considered
1. **Real token verify via JWKS (jose `createRemoteJWKSet` on LINE certs).**
   Trade-off: fully local crypto, no network on each verify; but must manage key rotation + `aud/iss/exp` checks by hand. Heavier than the documented `/verify` endpoint for a pilot.
2. **Push as synchronous in-request retries (loop with sleep), no table.**
   Trade-off: zero new model; but serverless time limits cap retries, a cold function loss drops the message, and "did it send" is unobservable — fails the bug #5 intent (status + durability).
3. **Chosen — token verify via LINE `/verify` endpoint; push as PushJob table + inline attempt + cron sweep.**
   Why over 1: simplest correct for a pilot, swap to JWKS later behind the same adapter. Why over 2: durable + observable status, fits Vercel cron (§11.2), enqueue is atomic with the money txn so a paid-order notification is never lost.

## KISS Gate
Is there a simpler way? For verify: yes, mock-only — but real-mode adapter is required by the convention (build the adapter, gate it). For push: the table is the *minimum* that makes push observable+durable; a plain retry loop was rejected (alt 2). No abstraction added beyond the two new `lib/` files (`push.ts`, line-adapter extension) and one hmac fn. NotiTopic deferred to avoid speculative scope.

## Cross-Cutting Concerns scan
- **Security: YES** — webhook signature (base64 HMAC, raw body, constant-time), token verify, caller-scoped order-history (no IDOR), CORS lock on webhook/internal (bug #14 carry). Loop security-reviewer at code review.
- **Database/Scale: YES** — push queue indices (`status,nextAttemptAt`), all state writes in `$transaction`, register-code redeem race (unique `code` + redeem-in-txn). Loop database-reviewer.
- **Observability: YES** — `LiffRequestLog`/`LineBotLog`/`PushJob.status+lastError` give audit + failure visibility (was the gap in bug #5).
- **Compliance (PDPA): YES** — `ConsentLog` + privacy notice; counsel reviews notice copy (Gate 0, not blocking build).
- **i18n/a11y:** Thai UI copy (designer owns warning/consent strings). **Cost:** none (mock vendors).

## Notes / deferred
- NotiTopic/NotiSubscriber deferred. Vercel Cron wiring lives in P7; P3 ships `api/cron/*` functions + dev trigger so the queue is exercisable now.
- Real LINE creds (`LINE_CHANNEL_*`) never required for build/test — Gate 0 respected.
- `relayPush` rewrite is the one behavior-changing edit to existing code; callers' signatures are preserved.
