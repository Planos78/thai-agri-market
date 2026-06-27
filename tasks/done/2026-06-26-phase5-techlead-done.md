# Tech Lead: Phase 5 Tech Spec — Settlement (payout + refund) + Web Checkout

Date: 2026-06-27 | Role: tech-lead | Stakes: durable, **money-critical** | Branch: main | apps/web
Stack: Next.js 16.2.9 (params is a Promise) + Prisma 7.8.0 + Supabase Postgres. Phases 1-4 merged + live.
Status: **SPEC ONLY — no feature code written.** `prisma validate` PASS on candidate schema (Prisma 7.8.0; see §A).

---

## 0. Hard convention (state in every developer task)

- **Mock-PSP boundary (Gate 0 enabler).** Payout + refund move **NO real funds.** They call the mock PSP adapter (`psp.ts`) and record DB state, exactly like P1 mock payment + P4 mock increase-pay. This is what lets P5 be built *before* the legal/accounting/counsel Gate 0 sign-off (roadmap §10 #9, §1): nothing goes live, no real money. If `PSP_PROVIDER` is set to a real provider without creds -> **throw loud, do not silently no-op.**
- **Atomicity (roadmap rule #1).** EVERY money/state change wrapped in `prisma.$transaction`. Drift here = real money lost. HMAC verify happens BEFORE any DB access on all callbacks (P1/P4 pattern).
- **Human-only approval (roadmap §4 boundary).** Payout batch create/submit AND refund create/approve are HUMAN-only mutations (admin perm). **No auto-approve path anywhere. No cron may approve.** Cron may only flag eligibility and sweep expiry.
- **Reuse, don't duplicate.** Web checkout reuses existing money (`money.ts`), order-no (`order-no.ts`), psp (`psp.ts`), orders (`orders.ts`) logic. Shared order-create logic extracted to a lib; LIFF + shop both call it. No second copy of money math.

---

## 1. Schema deltas (Prisma 7 — validated)

All new models + back-relations validate (§A). Existing P1-P4 models keep their fields; deltas below.

### 1.1 Existing-model deltas
- **`Order`**: add `refundedAmount Decimal @default(0)` (running sum of SUCCEEDED refunds; distinct from P4 `refundIntentAmount` which is intent). Add `source OrderSource @default(LIFF)` (which surface created it). Add back-relations `refunds Refund[]`, `payoutBatchOrders PayoutBatchOrder[]`.
- **`Payment`**: no new columns. `escrowStatus` transitions extended in code: `HELD` (paid) -> `RELEASED` (payout SUCCEEDED) -> `REFUNDED` (full refund SUCCEEDED).
- **`OrderAdjustment`**: add back-relation `refund Refund?` (a REDUCE adjustment's intent converts to one Refund).
- **`Orchard`**: add back-relation `payoutAccounts PayoutAccount[]`.
- **`AdminUser`**: add back-relations `payoutBatches PayoutBatch[]`, `refundsApproved Refund[]` (createdBy/approvedBy audit).
- **`enum OrderSource { LIFF SHOP }`** (new).

### 1.2 New models (exact Prisma 7)

```prisma
model Bank {                                   // roadmap §3.3 keep; seeded reference
  id       String  @id @default(uuid())
  code     String  @unique                     // BOT bank code e.g. "014" SCB
  name     String
  isActive Boolean @default(true)
  payoutAccounts PayoutAccount[]
}

model PayoutAccount {                           // §3.4 accounts; bug #11 real FKs
  id        String   @id @default(uuid())
  orchardId String
  bankId    String
  accNo     String
  accName   String
  payoutKey String?                             // PSP beneficiary key (mock)
  isDefault Boolean  @default(false)
  isActive  Boolean  @default(true)
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
  orchard Orchard @relation(fields: [orchardId], references: [id])
  bank    Bank    @relation(fields: [bankId], references: [id])
  payoutBatchOrders PayoutBatchOrder[]
  @@index([orchardId])
}

model PlatformConfig {                          // take-rate config (§5 #9); single active row
  id        String   @id @default(uuid())
  takeRate  Decimal  @default("0.10")           // 0.10 / 0.125 / 0.15
  vatRate   Decimal  @default("0.07")
  isActive  Boolean  @default(true)
  note      String?
  createdAt DateTime @default(now())
  @@index([isActive])
}

model PayoutBatch {                             // §3.4 payout_transactions; human-created
  id          String            @id @default(uuid())
  batchNo     String            @unique         // order-no scheme, prefix "PB"
  status      PayoutBatchStatus @default(DRAFT)
  totalAmount Decimal           @default(0)
  pspBatchRef String?
  createdBy   String                            // AdminUser.id (human-only)
  submittedAt DateTime?
  settledAt   DateTime?
  createdAt   DateTime          @default(now())
  updatedAt   DateTime          @updatedAt
  createdByAdmin AdminUser          @relation(fields: [createdBy], references: [id])
  orders         PayoutBatchOrder[]
  responses      PayoutResponse[]
  errorLogs      PayoutErrorLog[]
  @@index([status])
}
enum PayoutBatchStatus { DRAFT SUBMITTED SUCCEEDED FAILED }

model PayoutBatchOrder {                         // §3.4 payout_transaction_orders
  id              String  @id @default(uuid())
  payoutBatchId   String
  orderId         String
  payoutAccountId String
  amount          Decimal                        // = order.transferAmount snapshot at batch time
  batch         PayoutBatch   @relation(fields: [payoutBatchId], references: [id])
  order         Order         @relation(fields: [orderId], references: [id])
  payoutAccount PayoutAccount @relation(fields: [payoutAccountId], references: [id])
  @@unique([payoutBatchId, orderId])             // one order per batch (dedup)
  @@index([orderId])
}

model PayoutResponse {                           // §3.4 payout_responses; bug #11 FK to batch
  id String @id @default(uuid())
  payoutBatchId String
  respCode   String
  respDesc   String?
  pspBatchRef String?
  signature  String?
  rawPayload String
  accepted   Boolean  @default(false)
  receivedAt DateTime @default(now())
  batch PayoutBatch @relation(fields: [payoutBatchId], references: [id])
  @@index([payoutBatchId])
}

model PayoutErrorLog {                           // §3.4 payout_error_logs; bug #11 FK to batch
  id String @id @default(uuid())
  payoutBatchId String
  errorCode    String?
  errorMessage String
  rawPayload   String?
  createdAt    DateTime @default(now())
  batch PayoutBatch @relation(fields: [payoutBatchId], references: [id])
  @@index([payoutBatchId])
}

model Refund {                                   // §3.4 saleorder_refunds; converts P4 intent
  id                String       @id @default(uuid())
  refundNo          String       @unique         // order-no scheme, prefix "RF"
  orderId           String
  orderAdjustmentId String?      @unique          // 1:1 with the REDUCE adjustment when item-grain
  amount            Decimal
  kind              RefundKind                     // FULL | PARTIAL
  payoutType        RefundPayout @default(CUSTOMER)// CUSTOMER (refund buyer) | PLANT (clawback orchard)
  status            RefundStatus @default(PENDING)
  pspRef            String?                        // "RF-..." invoice for callback correlation (mock)
  approvedBy        String                         // AdminUser.id (human-only)
  approvedAt        DateTime?
  settledAt         DateTime?
  createdAt         DateTime     @default(now())
  updatedAt         DateTime     @updatedAt
  order           Order            @relation(fields: [orderId], references: [id])
  orderAdjustment OrderAdjustment? @relation(fields: [orderAdjustmentId], references: [id])
  approvedByAdmin AdminUser        @relation(fields: [approvedBy], references: [id])
  @@index([orderId])
  @@index([status])
}
enum RefundKind   { FULL PARTIAL }
enum RefundPayout { CUSTOMER PLANT }
enum RefundStatus { PENDING SUCCEEDED FAILED CANCELLED }
```

### 1.3 bug #11 fix (FK correctness)
- `PayoutResponse.payoutBatchId` -> FK `PayoutBatch` (not loose string). DONE above.
- `PayoutErrorLog.payoutBatchId` -> FK `PayoutBatch`. DONE above.
- `PaymentCallbackLog.orderId` -> FK `Order` already exists (added P1, line 236 of current schema). **No change needed** — note in dev task it is already compliant; do NOT re-add.

### 1.4 Take-rate location decision
**`PlatformConfig` table (single active row), NOT env.** Rationale: roadmap §5 #9 + §10 #8 treat take-rate as a *pricing experiment* (10/12.5/15%) that must be tunable per pricing-cell and auditable, and accountant must sign the VAT treatment. Env (`PLATFORM_TAKE_RATE`) stays as the **fallback/bootstrap default** so existing `money.ts` keeps working; `money.ts` gains an async `getRates()` that reads the active `PlatformConfig` row and falls back to env if none. Pure math fns (`calcFee`, `calcTransferAmount`) keep taking explicit `takeRate`/`vatRate` args (already do) — only the *resolver* changes. This is the simplest correct option: no schema churn for experiments, drops hardcoded 2%, keeps the proven pure fns unit-testable.

---

## 2. Money math contract (exact — money-critical)

Continues the **customer-pays-subtotal** model already shipped in P1/P4 (QA confirmed): buyer pays `subTotal`; platform fee + VAT are the platform's cut deducted at **payout**; VAT is charged **on the fee**, not the subtotal (QA P4 line 14). All amounts `round2`.

```
takeRate, vatRate         = active PlatformConfig (fallback env)         // §1.4
platformFee   (fee)       = round2(subTotal * takeRate)
platformVat   (vatFee)    = round2(fee * vatRate)                        // VAT on fee, P4 convention
total                     = subTotal                                      // customer pays subtotal
transferAmount (payout)   = max(0, round2(total - fee - vatFee - refundIntentAmount))   // OBS-1 CLAMP
payoutAmountPerOrder      = order.transferAmount                          // snapshot into PayoutBatchOrder.amount
```

### 2.1 OBS-1 fix — transfer clamp
P4 `calcTransferAmount` can return **negative** on full-order refund intent (QA: -96.30 = 900-90-6.30-900). P5 **clamps `transferAmount` to >= 0** at the source. Change `money.ts` `calcTransferAmount` to `Math.max(0, round2(...))`. A negative computed payout means the platform fee/VAT exceeds what is left after refund — the orchard is paid 0, never a negative. Any over-refund beyond `transfer` is a CUSTOMER refund obligation tracked by `Refund`, never a negative payout. This is a behavior change to a P4 fn — flag in dev task; the P4 reject-unfulfillable test that asserted -96.30 must be updated to assert 0.

### 2.2 Refund amount (full / partial; item-grain consistent with P4)
- **PARTIAL refund** = converts a single APPROVED REDUCE `OrderAdjustment` (intent) into a `Refund`. `amount = adjustment.amount` (= `deltaQty * item.price`, already computed P4). `kind = PARTIAL`, `orderAdjustmentId` set, `payoutType = CUSTOMER`.
- **FULL refund** = whole-order cancel/refund (e.g. reschedule-reject-unfulfillable path which already set `refundIntentAmount = totalAmount`). `amount = order.totalAmount - order.refundedAmount`. `kind = FULL`, `orderAdjustmentId` null.
- **Invariant guard:** `order.refundedAmount + refund.amount <= order.totalAmount` (reject 422 otherwise — no over-refund). On refund SUCCEEDED: `order.refundedAmount += amount`; if `refundedAmount == totalAmount` -> `Payment.escrowStatus = REFUNDED`, `Payment.status = REFUNDED`.

### 2.3 Worked examples
Order: durian 10@180 + mango 5@90, `subTotal = 2250`, takeRate 0.10, vatRate 0.07.
- `fee = 225.00`, `vatFee = 15.75`, `total = 2250`, no refund -> `transfer = 2009.25`.
- **PARTIAL** (P4 REDUCE mango 2 -> intent 180): after approve `subTotal=2070, fee=207, vatFee=14.49, refundIntent=180, transfer = max(0, 2070-207-14.49-180) = 1668.51`. P5 refund-create on that adjustment -> `Refund{amount:180, kind:PARTIAL}`. On callback SUCCEEDED: `order.refundedAmount = 180`; partial, so escrow stays HELD; orchard still gets `transfer=1668.51` at payout.
- **FULL** (reschedule-reject-unfulfillable, order total 900): P4 set `refundIntent=900`, P5-clamped `transfer = max(0, 900-90-6.30-900) = 0`. Refund-create -> `Refund{amount:900, kind:FULL}`. On callback SUCCEEDED: `refundedAmount=900 == total` -> `escrowStatus=REFUNDED`; payout amount 0 (order excluded from batch since `transfer=0`).
- **Payout batch**: 3 eligible orders transfer {2009.25, 1668.51, 0}. Batch includes only `transfer > 0` -> 2 orders, `totalAmount = 3677.76`.

---

## 3. State machines

### 3.1 Payout batch
```
DRAFT --(human submit, mock PSP)--> SUBMITTED --(mock callback respCode=2000)--> SUCCEEDED
                                              \--(mock callback respCode!=2000)--> FAILED
```
- Create: human (`payout.write`) selects eligible orders (see §4) -> `DRAFT` + `PayoutBatchOrder` rows + `totalAmount = sum(amount)`. All in `$transaction`.
- Submit: human -> call `getPsp().payout(batch)` (mock) -> `SUBMITTED` + `pspBatchRef`. `$transaction`.
- Callback (HMAC): `SUCCEEDED` -> for each order set `Payment.escrowStatus = RELEASED`; or `FAILED` -> no escrow change, write `PayoutErrorLog`. `$transaction`; write `PayoutResponse`.
- Guard: only `DRAFT` -> SUBMITTED; only `SUBMITTED` -> SUCCEEDED/FAILED. Re-callback on terminal = 409/no-op.

### 3.2 Refund
```
PENDING --(human approve, mock PSP)--> (still PENDING until callback) --(mock callback 2000)--> SUCCEEDED
                                                                       \--(callback !=2000)--> FAILED
PENDING --(human cancel before approve)--> CANCELLED
```
- Create: human (`refund.write`) -> `PENDING` + invariant guard (§2.2). `$transaction`.
- Approve: human -> call `getPsp().refund(req)` (mock) -> set `pspRef`, `approvedAt`. Stays `PENDING` until callback (mirrors P4 increase-pay: approve reserves invoice, callback confirms). **Human-only.**
- Callback (HMAC): `SUCCEEDED` -> `order.refundedAmount += amount`; if full -> escrow REFUNDED (§2.2). `FAILED` -> mark FAILED. `$transaction`; correlate by `pspRef` prefix `RF-`.

### 3.3 Escrow transitions
`HELD` (P1 on paid) -> `RELEASED` (payout batch SUCCEEDED, per order) -> `REFUNDED` (full refund SUCCEEDED). A RELEASED order can still take a PLANT-clawback refund (rare); CUSTOMER refund on a HELD order is the common path.

### 3.4 OBS-2 guard (state guard on adjustments/increase)
P4 `decideAdjustment` guards adjustment-PENDING + lot stock but NOT `Order.status`. P5 adds an order-status guard: **REDUCE/INCREASE adjustments and reschedules are blocked when `Order.status IN (DELIVERED, CANCELLED, EXPIRED)`** (settled/terminal). Add `canAdjustOrder(orderStatus)` returning true only for `PAID | PREPARING | RESCHEDULED`, called in `proposeAdjustment` + `decideAdjustment` + reschedule propose/decide. Returns 409 otherwise. This fixes OBS-2 (INCREASE approvable on DELIVERED order). Unit-test the guard.

---

## 4. Route contracts

All admin routes: `params` is a Promise (`await params`); auth via `requirePerm(req, "<perm>")`; scope via `requireOrderScope` where order-bound; mutations in `prisma.$transaction`. Callbacks: HMAC verify BEFORE any DB access. Shop routes: see §5 auth.

| # | Route | Method | Auth | Body (key fields) | Response / codes | $tx | HMAC |
|---|---|---|---|---|---|---|---|
| 1 | `api/admin/payout-accounts` | GET | `payout.read` | — (query orchardId) | 200 list / 401/403 | no | no |
| 2 | `api/admin/payout-accounts` | POST | `payout.write` | orchardId, bankId, accNo, accName, isDefault | 201 / 422 / 401/403 | yes (unset prior default) | no |
| 3 | `api/admin/payout-accounts/[id]` | PATCH/DELETE | `payout.write` | accNo.../isActive | 200 / 404 / 401/403 | yes | no |
| 4 | `api/admin/payout-batches` | GET | `payout.read` | query status | 200 list / 401/403 | no | no |
| 5 | `api/admin/payout-batches` | POST (create) | `payout.write` | orderIds[] (eligible) | 201 DRAFT+totalAmount / 422 ineligible / 409 already-batched / 401/403 | **yes** | no |
| 6 | `api/admin/payout-batches/[id]/submit` | POST | `payout.write` | — | 200 SUBMITTED+pspBatchRef / 409 not-DRAFT / 401/403 | **yes** | no (calls mock psp) |
| 7 | `api/interface/payout/callback` | POST | HMAC | batchNo/pspBatchRef, respCode, signature | 200 / 401 bad-sig | **yes** | **yes** |
| 8 | `api/admin/refunds` | GET | `refund.read` | query orderId/status | 200 / 401/403 | no | no |
| 9 | `api/admin/refunds` | POST (create) | `refund.write` | orderId, kind, amount\|orderAdjustmentId, payoutType | 201 PENDING / 422 over-refund / 409 OBS-2 / 401/403 | **yes** | no |
| 10 | `api/admin/refunds/[id]/approve` | POST | `refund.write` | — | 200 (PENDING, pspRef set) / 409 not-PENDING / 401/403 | **yes** | no (calls mock psp) |
| 11 | `api/interface/refund/callback` | POST | HMAC | pspRef (RF-...), respCode, signature | 200 / 401 bad-sig | **yes** | **yes** |
| 12 | `api/admin/platform-config` | GET/POST | `config.write` | takeRate, vatRate | 200 / 401/403 | yes (deactivate prior) | no |
| 13 | `api/shop/lots` | GET | public | — | 200 active+RELEASED lots | no | no |
| 14 | `api/shop/otp` + `api/shop/otp/check` | POST | public | phone (+ otp/ref) | 200 ref / 200 {shopSession} | no | no |
| 15 | `api/shop/order` | POST | shop session (§5) | items[], shippingAddress, phone | 201 order (source=SHOP) / 403 unverified | **yes** (order-no) | no |
| 16 | `api/shop/order/[id]/payment` | POST | shop session (owner) | — | 200 {paymentUrl, invoiceNo, amount} / 404 / 409 / 410 expired | no | no |

- **#5 eligible-order rule:** `status = PAID` (or `DELIVERED` if escrow-on-delivery chosen — see Alternatives), `Payment.escrowStatus = HELD`, `transferAmount > 0`, orchard has an active default `PayoutAccount`, not already in a non-FAILED `PayoutBatchOrder`. Recommend **PAID + HELD** as eligibility (hold-then-payout per blueprint); narrow to DELIVERED only if owner requires delivery-confirmed payout (open decision, flag to PM).
- **#7 / #11 callbacks** reuse the exact P1 pattern: `verifyHmac(callbackPayloadString(...), signature)` first; write response/error log + flip state in one `$transaction`; correlate by `batchNo`/`pspRef`. New canonical strings added to `psp.ts` (§7).
- **#15/#16 reuse:** call the shared `createOrder()` lib (extracted from `api/liff/order/route.ts`) and the same `getPsp().initPayment`. The existing `api/interface/payment/callback` route already keys on `orderNo` and flips any order to PAID — it serves SHOP orders unchanged (no new payment callback needed; SHOP orders use prefix "S" too, or a "W" prefix if disambiguation desired — recommend keep "S", source column distinguishes).

---

## 5. Web checkout surface (roadmap §7.2 — second surface)

- **Route groups:** `app/(shop)/**` (pages) + `app/api/shop/**` (handlers). Reuse `order-no`, `money`, `psp`, `orders`.
- **Auth decision: guest + phone-OTP, reusing the P1 OTP infra, NOT LINE.** Rationale: web buyers have no `lineUserId`; the existing `VerifiedLineUser` gate is LINE-specific. Cleanest reuse: the same `OtpLog` table (already `lineUserId String?` nullable) + `getSms()` adapter. Shop OTP issues against `phone` only (no lineUserId). On check, mint a **short-lived signed shop session** (reuse `jose` from `auth.ts`, new `signShopSession({phone})` / `verifyShopSession`, separate secret `SHOP_SESSION_SECRET`) returned as an httpOnly cookie. `api/shop/order` gates on a valid shop session whose phone matches; upserts a buyer `User` by phone (no email-from-line hack — use `${phone}@shop.local`). This avoids a new identity table, reuses OTP + SMS + JWT, and keeps web buyers cleanly separable (`Order.source = SHOP`).
- **Screens (minimal):** `(shop)/` browse lots, `(shop)/cart` -> confirm, `(shop)/verify` (phone OTP), `(shop)/order/[id]/pay` (PSP + poll), `(shop)/order/[id]` status. No reschedule/adjust/review web UI in P5 (LIFF already has them; out of scope).
- **No money-code duplication:** extract `createOrder(opts)` to `lib/order-create.ts` from the LIFF route; LIFF route + shop route both call it. Lot validation (ACTIVE + RELEASED, minOrderQty), `calcSubTotal`/`calcFee`, order-no in `$tx`, Payment create — all shared.

---

## 6. New RBAC perms (seed into admin role)

Add to `prisma/seed.ts` `permCodes`: `payout.read`, `payout.write`, `refund.read`, `refund.write`, `config.write`. Grant all to the `admin` role (existing seed loop handles it). Update QA env note: admin will have 15 perms. No new role needed for P5.

---

## 7. PSP adapter extension (`psp.ts`)

Extend `PspAdapter` interface + `MockPsp`; add canonical signed strings + mock-callback builders (reuse `hmac.ts`):
```ts
payout(batch: { batchNo: string; totalAmount: number; orders: {orderNo:string;amount:number}[] })
   : Promise<{ pspBatchRef: string }>
refund(req: { refundNo: string; amount: number })
   : Promise<{ pspRef: string }>
// canonical strings (stable mock + real):
payoutCallbackString({ batchNo, respCode })       // -> `${batchNo}|${respCode}`
refundCallbackString({ pspRef, amount, respCode }) // -> `${pspRef}|${amount}|${respCode}`
buildMockPayoutCallback(batchNo, respCode?)        // signed, for demo + tests
buildMockRefundCallback(pspRef, amount, respCode?) // signed
```
- `getPsp()` switch: add a **throw-loud** default for any non-`mock` provider lacking creds (e.g. `case "omise": if(!process.env.OMISE_SECRET) throw new Error("real PSP selected without creds — Gate 0 not cleared")`). Mock stays the only working path.
- Env vars: `PSP_PROVIDER=mock` (default), `PAYMENT_SECRET_KEY` (reused for HMAC; payout/refund callbacks sign with same secret unless `PAYOUT_SECRET_KEY`/`REFUND_SECRET_KEY` set — recommend reuse one secret in mock).

---

## 8. Test plan

### 8.1 Unit (DB-free, default `vitest run` green)
- `money.test.ts`: take-rate fee math at 0.10/0.125/0.15; VAT-on-fee; `transfer` clamp >= 0 (**OBS-1**: assert full-refund -> 0 not negative; update the P4 -96.30 assertion to 0).
- `refund.test.ts` (new): PARTIAL = adjustment.amount; FULL = total - refundedAmount; over-refund invariant rejected; `refundedAmount == total` -> escrow REFUNDED flag.
- `payout.test.ts` (new): batch `totalAmount = sum(transfer>0)`; orders with transfer 0 excluded; per-order amount = transferAmount snapshot.
- `fulfillment.test.ts`: **OBS-2** `canAdjustOrder` true only for PAID/PREPARING/RESCHEDULED; 409 on DELIVERED/CANCELLED/EXPIRED.
- State guards: payout DRAFT->SUBMITTED->SUCCEEDED/FAILED only; refund PENDING->SUCCEEDED/FAILED/CANCELLED only.

### 8.2 Integration (LIVE_DB-gated; mirror existing pattern — and fix BUG-1)
Mirror the `LIVE_DB`-gated suite. **Note QA BUG-1:** the P4 `fulfillment.integration.test.ts` is empty stubs. P5 integration tests must contain **real assertions** (create rows -> call tx core -> assert DB rows + money numbers), and the P4 stubs should be implemented or deleted (flag to dev as carry-forward).
- Payout: seed paid+HELD order with default PayoutAccount -> create batch -> submit (mock) -> mock callback SUCCEEDED -> assert `escrowStatus=RELEASED`, `PayoutResponse.accepted`, batch SUCCEEDED.
- Refund: approved REDUCE adjustment -> create refund -> approve (mock) -> mock callback SUCCEEDED -> assert `order.refundedAmount`, escrow REFUNDED on full.
- Bad HMAC on both callbacks -> 401, **zero DB writes** (count assertion, P4 AC6 pattern).
- Web checkout: shop OTP -> session -> `api/shop/order` (source=SHOP) -> `api/shop/order/[id]/payment` -> existing payment callback -> Order PAID.

### 8.3 vitest dotenv setup file — **recommend YES (low-risk)**
LIVE_DB tests need `DATABASE_URL`/`DIRECT_URL` sourced; vitest currently has no dotenv loader (QA OBS-3, process note). Add `vitest.setup.ts` with `import "dotenv/config"` and reference via `test.setupFiles` in `vitest.config.ts`. Low-risk: only affects test env, default DB-free suite unaffected (no DB access). Resolves the manual `env`-sourcing footgun for the whole LIVE_DB suite.

---

## 9. Migration

- Primary: `npx prisma migrate dev --name phase5` (uses `prisma.config.ts` -> `DIRECT_URL`, Supabase session port 5432; datasource block untouched).
- Fallback (if shadow-DB/pooling blocks migrate): `prisma migrate diff --from-schema-datamodel ... --script > phase5.sql` -> `prisma db execute --file phase5.sql --schema prisma/schema.prisma` -> `prisma migrate resolve --applied phase5`. Then `prisma generate`.
- Seed deltas: `Bank` rows (BOT codes), `PlatformConfig` active row (takeRate from env), 5 new perms, optional one `PayoutAccount` for the seeded orchard (demo).

---

## 10. Acceptance criteria (numbered, testable, for QA)

1. `prisma migrate status` up-to-date, `prisma validate` PASS, build + generate green; `PaymentCallbackLog`, `PayoutResponse`, `PayoutErrorLog` all have real FKs (bug #11).
2. Take-rate read from `PlatformConfig` active row (env fallback); changing it to 0.125 changes computed fee on a new order; no hardcoded 2% anywhere.
3. **OBS-1:** full-order refund-intent yields `transferAmount = 0` (never negative). Worked: 900-90-6.30-900 -> 0.
4. **OBS-2:** INCREASE/REDUCE adjustment + reschedule rejected (409) on DELIVERED/CANCELLED/EXPIRED order.
5. Payout batch: create (DRAFT, totalAmount = sum of transfer>0, excludes transfer=0) -> submit (SUBMITTED, mock pspBatchRef) -> mock callback SUCCEEDED -> every order `escrowStatus=RELEASED`, batch SUCCEEDED, `PayoutResponse` written; all atomic. **Human-only** (perm-gated; no cron/auto path).
6. Refund: create (PENDING, over-refund rejected 422) -> approve (human, mock psp, pspRef set) -> mock callback SUCCEEDED -> `order.refundedAmount += amount`; full refund -> `escrowStatus=REFUNDED`, `Payment.status=REFUNDED`; atomic.
7. Bad HMAC on payout callback AND refund callback -> 401, ZERO DB rows written (verified by count).
8. Web checkout: browse shop lots -> phone OTP -> shop session -> create order (`source=SHOP`) -> pay (mock PSP) -> payment callback -> Order PAID, Payment COMPLETED/HELD. Money identical to LIFF path (shared lib).
9. New perms (`payout.*`, `refund.*`, `config.write`) gate every admin route (401 no token, 403 missing perm); order-scoped routes enforce `requireOrderScope`.
10. **Gate 0 (no real funds):** `PSP_PROVIDER=mock`; payout + refund call mock adapter only; no real money moves; selecting a real provider without creds throws loud. All approvals human-only.
11. Default `vitest run` green (DB-free); LIVE_DB integration suite contains REAL assertions (not empty stubs — BUG-1 carry-forward addressed) and exercises AC5/6/7/8.

---

## A. prisma validate result

Ran `npx prisma validate` (Prisma 7.8.0) against a candidate schema = current models + all §1 P5 deltas + back-relations, in scratchpad:
```
Prisma schema loaded ... The schema at ...schema-p5.prisma is valid 🚀
```
PASS. (Two transient errors during construction were pre-existing `Order.adjustments`/`Order.reviews` back-relations omitted from the reduced copy — restored; they are not P5 deltas. The P5 models + new back-relations validate clean.)

## B. Alternatives Considered
1. **Take-rate in env only** — simplest, zero schema; rejected: roadmap wants per-experiment tunable + accountant-auditable, env is neither.
2. **Escrow released on DELIVERED (not PAID)** — safer for buyer (pay-after-delivery); trade-off: delays orchard cashflow, needs delivery-confirmed gate. Flagged as open decision; recommend PAID+HELD eligibility per blueprint hold-then-payout, narrowable later.
3. **Chosen — `PlatformConfig` table + PAID+HELD payout eligibility + guest phone-OTP web auth.** Why: matches roadmap money model, reuses P1 OTP/SMS/JWT for web with no new identity table, keeps proven pure money fns, and the mock-PSP boundary keeps the whole phase Gate-0-safe.

## KISS gate
Asked. No simpler correct option: refund + payout are inherently multi-table with callbacks; the spec adds the minimum models (6) and reuses every existing lib (money/psp/hmac/order-no/orders/auth). Web checkout adds zero new money code (shared `order-create` lib).

## Notes / risks
- Behavior change to P4 `calcTransferAmount` (clamp) — update the one P4 test asserting -96.30 to 0.
- `PaymentCallbackLog->Order` FK already exists; do NOT re-add (bug #11 already half-done in P1).
- Open decision for PM/owner: payout eligibility PAID vs DELIVERED (§4 #5, Alt 2).
- Carry-forward: implement or delete the empty P4 `fulfillment.integration.test.ts` stubs (QA BUG-1).
