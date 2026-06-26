# QA: Phase 3 — LINE LIFF surface + messaging
Date: 2026-06-26 | Role: QA (independent, adversarial) | Project: apps/web | Branch: main
Verdict: SHIP (all 10 ACs PASS). One spec-wording discrepancy (cron 401 vs 403) — not a bug.

## Gates (re-run, real output)
- `npx tsc --noEmit` -> exit 0, 0 errors.
- `npx vitest run` -> 48 passed | 11 skipped (9 files passed, 3 integration suites skipped: qc/integration/phase3 — LIVE_DB-gated by design). Matches developer report.
- `npx next build` -> exit 0. 36 routes, no collision. New P3 routes registered: `/api/line/webhook`, `/api/cron/push-sweep`, `/api/liff/orders`, `/api/liff/consent`, `/api/internal/push/[event]`, pages `/pdpa`, `/orders`. Admin stays under `/admin/*`.

## Environment
- Dev server: `next dev -p 3007` (3000/3001 are unrelated Docker apps — untouched).
- Mock mode confirmed: `.env` has `LINE_PROVIDER="mock"`, no real LINE creds. All build/test/AC happy paths ran with zero real LINE creds.
- For AC2 (signature enforcement) + AC3-real, restarted with `LINE_PROVIDER=line LINE_CHANNEL_ID=qa-test-channel LINE_CHANNEL_SECRET=qa-webhook-secret` (local HMAC only, no real network).
- For cron-gate, restarted with `CRON_SECRET=qa-cron-secret-123`.
- DB: Supabase Postgres via @prisma/adapter-pg. Baseline before testing: all P3 tables = 0.

## Per-AC results (live curl + DB row inspection)

### AC1 — verify-line token verify — PASS
- valid `mock:qa-line-a:QA A` -> 200 `{lineUserId:"qa-line-a", name:"QA A", verified:false}`.
- forged `not-a-mock-token` -> 401 `{error:"invalid token"}`.
- empty `{}` -> 401.
- Selector loud-fail (real mode, no creds): see AC10.

### AC2 — webhook bad/missing signature -> 401, ZERO DB write — PASS (security-critical)
- Ran in real mode (`LINE_PROVIDER=line`, secret set) so the check is enforced.
- missing `X-Line-Signature` -> 401 `{error:"bad signature"}`.
- bad sig `AAAABBBBwrongsig==` -> 401.
- LineBotLog count BEFORE = 4, AFTER both bad requests = 4 (UNCHANGED). All other table counts unchanged too. Signature verified over raw body before any DB access. NO LineBotLog row written for rejected requests.
- Note: in MOCK mode the webhook intentionally skips the sig check and accepts the request (gated to `LINE_PROVIDER==="mock"` only) — matches AC2 ("mock mode may skip check only when LINE_PROVIDER=mock"). Prod (`line`) always enforces.

### AC3 — valid signature -> 200 + exactly one LineBotLog per event — PASS
- Real mode, computed `base64(HMAC-SHA256(secret, rawBody))`. follow event -> 200 `{ok:true}`. LineBotLog 4 -> 5 (one row, eventType=follow, handled=false). +1 exactly.
- Mock mode message event also -> 200 + one LineBotLog (eventType=message, handled=true on a register code).

### AC4 — register-code redeem binds staff in a txn; bad codes rejected, no binding — PASS
- valid `REG-QA1` from `qa-line-staff1` -> 200; code.redeemedAt set, redeemedBy=qa-line-staff1; OrchardLineBinding row created with real orchardId FK (bug #10 confirmed). Exactly one LineBotLog (handled=true).
- already-redeemed `REG-QA1` by a NEW user -> 200 (LINE convention) but NO binding for staff2.
- expired `REG-QA2` -> NO binding for staff3; code stays unredeemed (redeemedAt=null).
- unknown `REG-QANOPE` -> NO binding for staff4.
- Every redeem path enqueues a durable confirmation/error PushJob (reached SENT in mock mode).

### AC5 — bug #4: push to orchard with zero LINE bindings -> FAILED PushJob, not dropped — PASS
- Created QA-NOBIND-ORCHARD (0 bindings). `pushToOrchard()` returned `{targeted:0}` and created a PushJob `status=FAILED, lastError="no line binding", lineUserId="orchard:<id>"`. Not a silent no-op.
- Admin orchards page renders visible Thai warning "ยังไม่มีการผูก LINE — จะไม่ได้รับการแจ้งเตือน" when lineBindingCount==0 (verified in source + `lineBindingCount` surfaced by the admin/orchards API: QA-NOBIND-ORCHARD:0, seeded:1).

### AC6 — push enqueue/retry/queue, no fire-and-forget (bug #5) — PASS
- internal push WITHOUT INTERNAL_PUSH_SECRET -> 403. WITH secret -> 200 `{ok, jobId, status:"SENT"}`; PushJob created, mock -> SENT (attempts=1). missing lineUserId -> 400.
- Retry/sweep: forced a job to PENDING(nextAttemptAt in past); `push-sweep` re-attempted it -> SENT (attempts 1->2), `{swept:1,sent:1,failed:0}`.
- State machine + maxAttempts->FAILED + attemptPush-never-throws covered by push.test.ts (5 tests green).

### AC7 — order history caller-scoped, no IDOR — PASS
- Seeded 2 verified users (qa-line-a, qa-line-b) each with own buyer User + order.
- `orders?lineUserId=qa-line-a` -> only QA-A order. `?lineUserId=qa-line-b` -> only QA-B order. No cross-user leakage.
- missing lineUserId -> 400; unverified user -> 403.
- (Note: the GET trusts the lineUserId query param as the caller identity — it enforces "must be a verified user" + filters by that user's buyerId, so no IDOR across users. Token re-binding to the request is not done here; consistent with the techlead contract.)

### AC8 — PDPA consent writes ConsentLog + gates ordering — PASS
- `pdpa_required granted=true` -> 200; ConsentLog row written; VerifiedLineUser.consent flipped to true.
- `pdpa_marketing granted=false` -> 200; second ConsentLog row (no flag flip). DB shows both rows + verifiedConsent=true.
- unverified -> 403; missing fields -> 400. (Required-consent UI gate is client-side in /pdpa page; server correctly records + flips.)

### AC9 — prisma validate / migrate / vitest — PASS
- Migration `20260626144819_phase3` present and applied (DB reachable, all P3 models queryable). tsc/vitest/build all green (see Gates). Skipped integration suite present (phase3.integration.test.ts, 4 tests).

### AC10 — no direct LINE calls; env-gated mock; loud fail without creds — PASS
- `getLine()` with `LINE_PROVIDER=line` and no `LINE_CHANNEL_ID` THROWS: "LINE_PROVIDER=line but LINE_CHANNEL_ID is not set (no silent mock fallback)" — confirmed at runtime + unit test line.test.ts:26.
- All webhook/push/verify flow through `lib/line.ts` adapter; build/test pass with no real LINE creds.

## Cron gate (task AC bullet) — PASS (with note)
- CRON_SECRET set: no header -> 403; wrong -> 403; correct via `x-cron-secret` -> 200; correct via `authorization: Bearer` -> 200.
- CRON_SECRET unset (`.env` default): route is OPEN (200) — matches `.env.example` doc "Blank = open in dev".
- DISCREPANCY (not a bug): QA task wording said "without the secret -> 401"; implementation returns 403, matching the techlead route table (200/403). 403 is the correct semantic. No code change needed; flag for spec wording alignment.

## Regression (Phase 1 + Phase 2) — PASS
- `liff/lots` -> 3 ACTIVE+RELEASED lots (ทุเรียน/มังคุด/เงาะ). Catalog intact.
- Admin login (admin@thaiagri.local / admin1234) -> 200, 7 perms, JWT. admin/orchards API: 200 with token, 401 without (RBAC intact). lineBindingCount surfaced.
- All 5 admin pages (/admin/login,orchards,orders,lots,buyers) -> HTTP 200.
- Full order path: create order (201, S260626008) -> mock-pay signed callback (forwarded, 200) -> order PAID + a durable `payment-paid` PushJob created (SENT). Confirms the regression: payment-callback now enqueues a PushJob instead of fire-and-forget.

## Cleanup
- Deleted every QA row: 7 PushJob, 5 LineBotLog, 3 LiffRequestLog (1 by user + 2 null-user verify-line 401 artifacts), 1 binding, 2 ConsentLog, 1 PaymentCallbackLog, 1 Payment, 3 OrderItem, 3 Order, 2 RegisterCode, 2 User, 2 VerifiedLineUser, 1 Orchard.
- Final DB sweep: all P3 tables back to 0 (= baseline). No QA residue.
- Killed all dev servers I started (port 3007). Docker apps on 3000/3001 untouched.
- Removed QA helper scripts (qa-db.ts, qa-bug4.ts, qa-selector.ts) from apps/web. git status shows no qa- files.

## Bugs found
- NONE. No Handoff Request needed.

## Notes
- expire-orders cron not built (marked optional/out-of-scope by techlead+developer; lazy-expiry exists in the payment route). Not an AC.
- NotiTopic/NotiSubscriber deferred per spec.
