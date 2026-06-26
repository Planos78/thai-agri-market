# Phase 1 build — handoff (resume in a fresh session)

Spec: `docs/blueprint-adaptation-roadmap.md` §9. Work in `apps/web`, paths under `src/**`, alias `@/*` -> `src/*`.
Next.js 16.2.9 + React 19 (App Router). **Read `node_modules/next/dist/docs/` before writing route handlers** — `params` is a Promise in dynamic routes (`await params`). Prisma 7.8, Postgres.

Locked decisions: mock adapters (PSP/SMS/LINE) via env; clean-break LINE auth; minimal JWT admin auth; escrow HELD on paid; NO payout/refund (P5).

## DONE
- `prisma/schema.prisma` — all ~16 P1 models (VerifiedLineUser, OtpLog, Order+money/orderNo/expiry, OrderRunningNo, Payment, PaymentCallbackLog, AdminUser/AdminRole/Permission/AdminRolePermission, etc).
- `src/lib/`: `db.ts`, `hmac.ts` (sign/verify), `money.ts` (calcSubTotal/calcFee/calcTransferAmount, configurable take-rate+VAT), `order-no.ts` (bangkokYymmdd, formatOrderNo, generateOrderNo with FOR UPDATE), `orders.ts` (isOrderExpired, HOLD_MS), `auth.ts` (hashPassword/verifyPassword scrypt, signAdminJwt/verifyAdminJwt jose, bearer), `psp.ts` (PspAdapter + MockPsp + callbackPayloadString + buildMockCallback, PSP_SUCCESS="2000"), `line.ts` (LineAdapter + MockLine + relayPush), `sms.ts` (SmsAdapter + MockSms + genOtp).

## TODO
1. **package.json** — deps: add `jose`. devDeps: add `vitest`, `tsx`. (scripts: add `"test": "vitest run"`, `"seed": "tsx prisma/seed.ts"`.)
2. **.env** — append dev defaults (names): `PAYMENT_SECRET_KEY`, `ADMIN_JWT_SECRET`, `PLATFORM_TAKE_RATE=0.10`, `VAT_RATE=0.07`, `PSP_PROVIDER=mock`, `SMS_PROVIDER=mock`, `LINE_PROVIDER=mock`, `INTERNAL_PUSH_SECRET`. Also write `.env.example` with names only.
3. **API routes** (`src/app/api/**/route.ts`) — use `import { NextResponse } from "next/server"`, `await req.json()`, `await params` for dynamic:
   - `liff/verify-line` POST {idToken} -> getLine().verifyIdToken -> {lineUserId, verified: !!VerifiedLineUser}.
   - `liff/otp` POST {phone,lineUserId} -> create OtpLog (reference=uuid, otp=genOtp(), expiresAt=+5min) -> getSms().send -> {reference, devOtp when mock}.
   - `liff/otp/check` POST {reference,otp,name?} -> validate OtpLog (not expired/consumed, otp match) -> set consumedAt -> upsert VerifiedLineUser -> {verified:true, lineUserId}.
   - `liff/lots` GET -> Lot where status=ACTIVE, include orchard {name,province}.
   - `liff/order` POST {lineUserId, items:[{lotId,quantity}], shippingAddress} -> **gate: VerifiedLineUser must exist else 403** -> findOrCreate User by lineUserId -> load lots -> calcSubTotal/calcFee -> `prisma.$transaction`: generateOrderNo("S"), create Order (paymentExpiredAt=now+HOLD_MS, totalAmount=subTotal+fee+vat), OrderItems, Payment(PENDING, amount=total) -> return order.
   - `liff/order/[id]/payment` POST -> load order; if isOrderExpired -> set EXPIRED + 410; else getPsp().initPayment -> {paymentUrl, invoiceNo, amount}.
   - `interface/payment/callback` POST {invoiceNo,amount,respCode,signature,tranRef?} -> verifyHmac(callbackPayloadString(...), signature). **Bad sig -> 401, NO db write (AC4).** Good -> `prisma.$transaction`: create PaymentCallbackLog(accepted:true), find Order by orderNo=invoiceNo, if respCode===PSP_SUCCESS set Order.status=PAID+paidAt, Payment.status=COMPLETED+escrowStatus=HELD+channel/callbackRef; else Payment.status=FAILED. After tx: relayPush("payment-paid", buyer.lineUserId, msg). Return ok.
   - `internal/push/[event]` POST {lineUserId,message} -> (optional check x-internal-secret === INTERNAL_PUSH_SECRET) -> relayPush(event,...) -> ok.
   - `admin/auth/login` POST {email,password} -> AdminUser+role+perms -> verifyPassword -> signAdminJwt -> {token}.
   - `admin/orders` GET -> verifyAdminJwt(bearer(req)); require perm "orders.read" else 403 -> list Orders (include items, payment).
4. **Screens** (`src/app/(liff)/**` + `(admin)/**`, minimal client components, reuse `@/components/ui/button`):
   welcome, register, otp, lots, order/confirm, order/[id]/pay (calls payment, shows mock pay button that POSTs buildMockCallback to interface/payment/callback), (admin)/login, (admin)/orders. Keep existing `src/app/page.tsx` landing.
5. **prisma/seed.ts** — AdminRole "admin" + Permission "orders.read" + link; AdminUser admin@thaiagri.local / "admin1234" (hashPassword); owner User; verified Orchard; 3 ACTIVE Lots; VerifiedLineUser lineUserId="mock-buyer-1" phone.
6. **Tests** (`src/lib/__tests__/*.test.ts`, vitest) — hmac verify valid/tampered; formatOrderNo; bangkokYymmdd length=6; calcSubTotal/calcFee/calcTransferAmount; isOrderExpired. DB-dependent ACs (2 concurrency, 5 atomic, 6 RBAC) -> integration tests `describe.skip` w/ run notes.
7. **Run**: `npx prisma generate`; `npx prisma migrate dev --name phase1` (if DB down, write SQL migration manually + note DB must start); `npx tsc --noEmit`; `npx vitest run`. Fix what's reasonable. Honest report on what runs.

## 7 acceptance criteria (verify)
1 unverified can't order · 2 orderNo unique under concurrency · 3 expire 1h -> EXPIRED · 4 bad HMAC rejected no-write · 5 valid callback PAID+COMPLETED/HELD+log atomic · 6 admin login + read RBAC-scoped · 7 push via internal relay not direct LINE.
