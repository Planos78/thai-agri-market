# Done: Phase 3 — LINE LIFF surface + messaging
Date: 2026-06-26 | Role: developer | Stakes: durable | Project: apps/web

## Migration
- Path that worked: `npx prisma migrate dev --name phase3` (shadow DB reachable via prisma.config.ts -> DIRECT_URL; fallback not needed).
- Output: `Applying migration 20260626144819_phase3 ... Your database is now in sync with your schema.`
- Migration SQL creates: PushStatus enum + OrchardRegisterCode, OrchardLineBinding, LiffRequestLog, LineBotLog, PushJob; all indices (`PushJob(status,nextAttemptAt)` etc.) + 2 FKs to Orchard.
- `npx prisma validate` = valid; `npx prisma generate` = client v7.8.0 generated.

## Self-verify (all 3 green)
- `npx tsc --noEmit` -> exit 0 (0 errors).
- `npx vitest run` -> 48 passed | 11 skipped (9 files passed, 3 integration suites skipped as designed).
- `npx next build` -> exit 0. All new routes registered, no route-group collision; admin stays under /admin/*.

## Files created
- prisma/migrations/20260626144819_phase3/migration.sql
- src/lib/push.ts (enqueuePush/attemptPush/sweepPushJobs/pushToOrchard — PushJob state machine + backoff)
- src/lib/line-webhook.ts (extractRegisterCode/redeemRegisterCode/handleLineEvent)
- src/app/api/line/webhook/route.ts (raw body, verifyLineSignature before any DB write, mock-skip gated)
- src/app/api/cron/push-sweep/route.ts (CRON_SECRET gated, GET+POST)
- src/app/api/liff/consent/route.ts ($tx ConsentLog + VerifiedLineUser.consent flip)
- src/app/api/liff/orders/route.ts (caller-scoped, no IDOR)
- src/app/(liff)/pdpa/page.tsx, src/app/(liff)/orders/page.tsx
- src/lib/__tests__/line.test.ts, push.test.ts, webhook.test.ts, phase3.integration.test.ts

## Files changed
- prisma/schema.prisma (5 models + PushStatus enum + Orchard back-relations registerCodes/lineBindings)
- src/lib/line.ts (LineRealAdapter: /verify token + Messaging API push; loud selector; relayPush rewritten -> enqueuePush+attemptPush, durable)
- src/lib/hmac.ts (verifyLineSignature: base64 HMAC-SHA256 over raw body, constant-time)
- src/app/api/internal/push/[event]/route.ts (enqueue+attempt, returns {ok,jobId,status})
- src/app/api/liff/verify-line/route.ts (writes LiffRequestLog)
- src/app/api/admin/orchards/route.ts (+lineBindingCount via _count)
- src/app/(admin)/admin/orchards/page.tsx (bug #4 visible "ยังไม่มีการผูก LINE" warning)
- src/app/(liff)/otp/page.tsx (route OTP success -> /pdpa before /lots)

## Env vars added to .env.example
- LINE_CHANNEL_ID, LINE_CHANNEL_SECRET, LINE_CHANNEL_ACCESS_TOKEN, CRON_SECRET
- (LINE_PROVIDER, INTERNAL_PUSH_SECRET already present from P1/P2)

## Bug fixes per spec
- #4: orchard 0-binding warning on admin view; pushToOrchard records FAILED PushJob (lastError="no line binding") instead of silent drop.
- #5: PushJob queue, inline attempt + cron sweep retry, never fire-and-forget; relayPush rewritten.
- #6: bot state DB-backed (LineBotLog/binding rows), no in-memory map.
- #10: OrchardRegisterCode.orchardId is a real FK to Orchard.

## Convention
- LINE stays mock by default (LINE_PROVIDER=mock); real adapter throws loud if selected without LINE_CHANNEL_ID. Webhook mock-skips signature only when LINE_PROVIDER=mock. Build+tests pass with zero real LINE creds.

## Notes
- expire-orders cron (§6/§9, marked optional) NOT built — out of explicit scope; push-sweep is the required cron.
- NotiTopic/NotiSubscriber deferred per spec.
- .env.example is gitignored in this repo; edits written to disk but won't appear in git status.
- Did NOT commit (per task).
