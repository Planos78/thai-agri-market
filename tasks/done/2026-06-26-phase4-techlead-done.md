# Tech Lead: Phase 4 — Fulfillment (TECH SPEC)
Date: 2026-06-26 | Role: tech-lead | Stakes: durable | Spec only (no feature code)

Grounded in: roadmap §3.4/§4/§5/§7.2/§8/§11.2; `schema.prisma`; `lib/{money,order-no,orders,psp,line,push,rbac,hmac,auth}.ts`; `api/interface/payment/callback`, `api/liff/order`, `api/admin/lots/[id]/qc`, `api/admin/orders`; `prisma/seed.ts`; `prisma.config.ts`; `__tests__/*`.

## Scope (P4)
Reschedule (orchard proposes / buyer confirms), order adjustment at ITEM grain (reduce->refund-intent / increase->pay-more), increase-payment via mock PSP, delivery proof + images via storage adapter, mark delivered, review with `Orchard.rating` recompute. Money mutations in `prisma.$transaction`. Approvals HUMAN-only. No real funds (mock PSP, Gate 0).

---

## 1. Schema deltas (`apps/web/prisma/schema.prisma`)

### Enums (new)
```prisma
enum RescheduleStatus { PENDING APPROVED REJECTED }            // P/A/R
enum AdjustmentKind   { REDUCE INCREASE }
enum AdjustmentStatus { PENDING APPROVED REJECTED CANCELLED }  // P/A/R/C
enum IncreasePayStatus{ PENDING SUCCEEDED EXPIRED CANCELLED }  // P/S/E/C
enum DeliveryStatus   { PENDING IN_TRANSIT DELIVERED }
enum ProposedBy       { ORCHARD BUYER }
```

### Order lifecycle delta
- Extend `OrderStatus`: keep `WAITING_PAYMENT PAID PREPARING DELIVERED CANCELLED EXPIRED`; **add `RESCHEDULED`** (transient orchard-proposed-awaiting-buyer marker is held on `DeliveryReschedule.status`, NOT a new Order state — keep Order enum lean). Decision: do NOT add per-adjustment Order states; adjustment/reschedule lifecycle lives on their own tables. Order only moves `PAID->PREPARING->DELIVERED` plus `->CANCELLED`.
- Add `Order.deliveryDate DateTime?` (the agreed delivery date; reschedule mutates it on approve).
- Add `Order.refundIntentAmount Decimal @default(0)` (running sum of approved REDUCE refund intent; P4 records intent only, P5 pays — see §below).
- Back-relations on `Order`: `reschedules DeliveryReschedule[]`, `adjustments OrderAdjustment[]`, `increasePayments IncreasePayment[]`, `delivery Delivery?`, `reviews Review[]`.

### DeliveryReschedule
```prisma
model DeliveryReschedule {
  id           String           @id @default(uuid())
  orderId      String
  proposedDate DateTime
  proposedBy   ProposedBy
  status       RescheduleStatus @default(PENDING)
  note         String?
  decidedBy    String?          // adminUserId OR lineUserId of decider
  decidedAt    DateTime?
  createdAt    DateTime         @default(now())
  updatedAt    DateTime         @updatedAt
  order        Order            @relation(fields: [orderId], references: [id])
  @@index([orderId])
  @@index([status])
}
```

### OrderAdjustment (ITEM grain — roadmap §11.2 multi-lot cart)
```prisma
model OrderAdjustment {
  id          String           @id @default(uuid())
  orderId     String
  orderItemId String                           // item-grain; required
  kind        AdjustmentKind
  deltaQty    Int                              // >0 always; direction in `kind`
  amount      Decimal                          // money delta = deltaQty * item.price (refund intent for REDUCE / pay-more for INCREASE)
  status      AdjustmentStatus @default(PENDING)
  note        String?
  proposedBy  ProposedBy
  decidedBy   String?
  decidedAt   DateTime?
  createdAt   DateTime         @default(now())
  updatedAt   DateTime         @updatedAt
  order       Order            @relation(fields: [orderId], references: [id])
  orderItem   OrderItem        @relation(fields: [orderItemId], references: [id])
  increasePayment IncreasePayment?
  @@index([orderId])
  @@index([orderItemId])
  @@index([status])
}
```
- Add back-relation on `OrderItem`: `adjustments OrderAdjustment[]`.

### IncreasePayment (pay-more on qty INCREASE; mock PSP)
```prisma
model IncreasePayment {
  id           String            @id @default(uuid())
  adjustmentId String            @unique       // 1:1 with the INCREASE adjustment
  orderId      String
  amount       Decimal
  status       IncreasePayStatus @default(PENDING)
  pspRef       String?
  expiresAt    DateTime?                        // created + HOLD_MS (reuse 1h, roadmap §5 r7)
  paidAt       DateTime?
  createdAt    DateTime          @default(now())
  updatedAt    DateTime          @updatedAt
  adjustment   OrderAdjustment   @relation(fields: [adjustmentId], references: [id])
  order        Order             @relation(fields: [orderId], references: [id])
  @@index([orderId])
  @@index([status])
}
```

### Delivery + DeliveryImage (proof; store URL/path only — bug #7)
```prisma
model Delivery {
  id             String         @id @default(uuid())
  orderId        String         @unique
  status         DeliveryStatus @default(PENDING)
  trackingNo     String?
  carrier        String?
  proofUploadedBy String?       // adminUserId (ops/CX)
  deliveredAt    DateTime?
  createdAt      DateTime       @default(now())
  updatedAt      DateTime       @updatedAt
  order          Order          @relation(fields: [orderId], references: [id])
  images         DeliveryImage[]
}
model DeliveryImage {
  id         String   @id @default(uuid())
  deliveryId String
  url        String                 // path or URL ONLY, never binary (bug #7)
  uploadedAt DateTime @default(now())
  delivery   Delivery @relation(fields: [deliveryId], references: [id])
  @@index([deliveryId])
}
```

### Review delta (§5 #10 rating-recompute fix)
- Add FK relation + back-relations (current `Review` has loose `orchardId`/`orderId` strings, no relation):
```prisma
// add to Review:
orchard Orchard? @relation(fields: [orchardId], references: [id])
order   Order?   @relation(fields: [orderId], references: [id])
@@index([orchardId])
@@index([orderId])
```
- Add back-relations: `Orchard.reviews Review[]`, `Order.reviews Review[]`.
- Keep `Orchard.rating Decimal @default(0)`; recompute on insert (avg of reviews for orchard) inside the submit-review tx.

### Refund-intent vs P5 boundary (DECISION — money-safe)
- P4 records refund **intent only** on `OrderAdjustment.amount` (REDUCE) + accumulates into `Order.refundIntentAmount`. No `Refund` table, no payout, no PSP refund call in P4. The actual `Refund` model + payout movement stays **P5** (roadmap §3.4 puts Refund in P5; §10 #9 gates real money on legal/accounting). Recompute `Order.transferAmount` using existing `calcTransferAmount(total, fee, vat, refundIntentAmount)` so the payout figure is already net of intent when P5 pays.

---

## 2. State machines (allowed transitions only)

**Reschedule** (`DeliveryReschedule.status`): `PENDING -> APPROVED` (decider confirms; sets `Order.deliveryDate = proposedDate`, `Order.status` PAID/PREPARING unchanged) | `PENDING -> REJECTED`. Reject of an ORCHARD-proposed reschedule that the buyer declines AND order cannot be fulfilled => `Order.status = CANCELLED` + accumulate full-order refund intent (roadmap §4 reschedule reject -> CANCELLED + refund). Terminal: APPROVED, REJECTED. No PENDING->PENDING; a new proposal = new row (prior PENDING auto-superseded -> REJECTED in same tx).

**Adjustment** (`OrderAdjustment.status`): `PENDING -> APPROVED` | `PENDING -> REJECTED` | `PENDING -> CANCELLED` (proposer withdraws before decision). On APPROVED: mutate `OrderItem.quantity` (REDUCE: `-deltaQty`; INCREASE: `+deltaQty`), recompute order totals (§3), and — REDUCE: add `amount` to `Order.refundIntentAmount`; INCREASE: create `IncreasePayment(PENDING)`. Guard: `deltaQty <= orderItem.quantity` for REDUCE; REDUCE to 0 on the only item => order CANCELLED + full refund intent. Terminal: APPROVED, REJECTED, CANCELLED.

**Increase-payment** (`IncreasePayment.status`): `PENDING -> SUCCEEDED` (mock PSP callback success; sets `paidAt`) | `PENDING -> EXPIRED` (lazy-check `now>expiresAt`, mirrors `isOrderExpired`) | `PENDING -> CANCELLED` (parent adjustment cancelled). Terminal: SUCCEEDED, EXPIRED, CANCELLED. EXPIRED increase-payment does NOT roll back the already-approved qty (ops decision: qty stands, money owed flagged) — note for QA; alternative is reverse-on-expire (rejected: complicates item grain).

**Order lifecycle** (P4-relevant): `PAID -> PREPARING` (ops starts fulfillment / first delivery proof) ; `PREPARING -> DELIVERED` (mark-delivered after proof) ; `PAID|PREPARING -> CANCELLED` (reschedule-reject / full-reduce). `DELIVERED` is terminal for fulfillment; review allowed only when `DELIVERED`.

**Approvals are HUMAN-only** (roadmap §4 boundary): every `-> APPROVED`/`-> REJECTED` is an explicit operator (admin perm) or buyer (verified-line) mutation. No auto-approve, no cron that approves.

---

## 3. Money math (item grain; reuse `lib/money.ts`)
- Customer-pays model (from P1 `api/liff/order`): customer pays `subTotal`; `feeAmount`/`vatFeeAmount` are platform cut deducted at payout. Keep identical.
- **REDUCE approve**: `delta = round2(deltaQty * Number(orderItem.price))`. In tx: `OrderItem.quantity -= deltaQty`; recompute `subTotal = calcSubTotal(remainingLines)`; `{feeAmount,vatFeeAmount} = calcFee(subTotal)`; `totalAmount = subTotal`; `refundIntentAmount += delta`; `transferAmount = calcTransferAmount(totalAmount, feeAmount, vatFeeAmount, refundIntentAmount)`. Persist all on `Order`. `OrderAdjustment.amount = delta`.
- **INCREASE approve**: `delta = round2(deltaQty * Number(orderItem.price))`. In tx: `OrderItem.quantity += deltaQty`; recompute `subTotal/fee/vat/total` (now larger); `transferAmount` recomputed; create `IncreasePayment{amount: delta, status: PENDING, expiresAt: now+HOLD_MS}`. `OrderAdjustment.amount = delta`. Lot stock check: `deltaQty <= lot.quantity` available (guard).
- **Increase-payment success** (mock PSP callback): set `IncreasePayment.status=SUCCEEDED, paidAt`; no further total change (totals already include the increase at approve-time). Optionally bump `Payment.amount`. All in tx.
- Take-rate/VAT stay env-driven (`TAKE_RATE()`/`VAT_RATE()`); never re-hardcode. `transfer = total - fee - vat - refundIntent` (roadmap §5 #9).

---

## 4. Route contracts (params is a Promise — Next.js 16; see `node_modules/next/dist/docs/` before coding)

Auth legend: `perm:X` = `requirePerm(req,"X")`; `verified-line` = body `lineUserId` resolved via `verifiedLineUser.findUnique` (P1 pattern). `[id]` handlers: `{ params }: { params: Promise<{ id: string }> }`, `const { id } = await params`.

| # | Route | Method | Auth | Body | Resp / codes | Prisma (in $tx?) |
|---|---|---|---|---|---|---|
| 1 | `/api/admin/orders/[id]/reschedule` | POST | perm:`fulfillment.reschedule` + scope | `{proposedDate, note?}` | 201 `{reschedule}` / 401 403 404 422 | create DeliveryReschedule(PENDING, proposedBy=ORCHARD); supersede prior PENDING (tx). relayPush buyer |
| 2 | `/api/liff/order/[id]/reschedule` | POST | verified-line (buyer owns order) | `{proposedDate, note?}` | 201 / 403 404 422 | same, proposedBy=BUYER. pushToOrchard |
| 3 | `/api/liff/order/[id]/reschedule/[rid]/decide` | POST | verified-line (buyer) | `{decision:"APPROVE"\|"REJECT"}` | 200 `{order,reschedule}` / 403 404 409 | **tx**: guard PENDING; APPROVE-> Order.deliveryDate=proposedDate; REJECT(+unfulfillable)-> Order.CANCELLED + refundIntent. relayPush |
| 4 | `/api/admin/orders/[id]/reschedule/[rid]/decide` | POST | perm:`fulfillment.reschedule`+scope | `{decision}` | 200 / 401 403 404 409 | same as #3 (operator decides BUYER-proposed) |
| 5 | `/api/admin/orders/[id]/adjustments` | POST | perm:`fulfillment.adjust`+scope | `{orderItemId, kind, deltaQty, note?}` | 201 `{adjustment}` / 400 403 404 422 | compute amount; create OrderAdjustment(PENDING). relayPush buyer |
| 6 | `/api/liff/order/[id]/adjustments` | POST | verified-line (buyer) | `{orderItemId, kind, deltaQty, note?}` | 201 / 403 404 422 | same, proposedBy=BUYER. pushToOrchard |
| 7 | `/api/admin/orders/[id]/adjustments/[aid]/decide` | POST | perm:`fulfillment.adjust`+scope | `{decision}` | 200 `{order,adjustment,increasePayment?}` / 403 404 409 422 | **tx**: guard PENDING+deltaQty<=qty(REDUCE)/lot.qty(INCREASE); mutate OrderItem.qty; recompute totals (§3); REDUCE->refundIntent; INCREASE->create IncreasePayment. relayPush |
| 8 | `/api/admin/orders/[id]/adjustments/[aid]/cancel` | POST | perm:`fulfillment.adjust` OR proposer | `{}` | 200 / 403 404 409 | **tx**: PENDING->CANCELLED; cancel child IncreasePayment if any |
| 9 | `/api/liff/increase-payment/[ipid]/pay` | POST | verified-line (buyer) | `{}` | 200 `{paymentUrl,invoiceNo}` / 403 404 409 410(expired) | lazy-expire check; `getPsp().initPayment({orderNo, amount})`; persist pspRef |
| 10 | `/api/interface/payment/callback` (extend existing) | POST | HMAC (verify before DB) | PSP callback `{invoiceNo,...}` | 200 / 401 | **tx**: branch invoiceNo => Order vs IncreasePayment; success-> IncreasePayment.SUCCEEDED+paidAt; write PaymentCallbackLog. relayPush. *Decision: increase-pay invoiceNo prefix `IP-` to disambiguate from order `S...`.* |
| 11 | `/api/admin/orders/[id]/delivery` | POST | perm:`delivery.write`+scope | `{trackingNo?, carrier?}` | 200 `{delivery}` / 401 403 404 | upsert Delivery; Order.PAID->PREPARING |
| 12 | `/api/admin/orders/[id]/delivery/proof` | POST | perm:`delivery.write`+scope | multipart/form-data file(s) | 201 `{images}` / 400 403 404 413 | `putImage()` per file (storage adapter); **tx**: create DeliveryImage rows + set proofUploadedBy + Delivery.IN_TRANSIT |
| 13 | `/api/admin/orders/[id]/delivery/deliver` | POST | perm:`delivery.write`+scope | `{}` | 200 `{order,delivery}` / 403 404 409 | **tx**: require >=1 DeliveryImage; Delivery.DELIVERED+deliveredAt; Order.PREPARING->DELIVERED. relayPush buyer |
| 14 | `/api/liff/order/[id]/review` | POST | verified-line (buyer owns + DELIVERED) | `{rating(1-5), comment?}` | 201 `{review,orchardRating}` / 403 404 409 422 | **tx**: create Review (FK orchardId from order's lot, orderId); recompute Orchard.rating = avg; one review per order (unique guard) |

All money/state-flip handlers wrap mutations in `prisma.$transaction` (rows tx-marked above). Callback verifies HMAC before any DB read (P1 invariant).

---

## 5. New RBAC perms (attach to admin role in `prisma/seed.ts` permCodes[])
- `fulfillment.reschedule` — propose/decide reschedule (admin side)
- `fulfillment.adjust` — propose/decide/cancel adjustment + trigger increase-payment
- `delivery.write` — create delivery, upload proof, mark delivered
- (`orders.read` already exists for console reads)
Seed: append `["fulfillment.reschedule","Reschedule deliveries"], ["fulfillment.adjust","Adjust order quantities"], ["delivery.write","Write delivery + proof"]` to `permCodes`; existing upsert loop attaches them to role `admin`. Scope enforced via `scopedOrchardIds`/`inScope` against the order's lot.orchardId (resolve orchard from `order.items[0].lot.orchardId`; multi-orchard cart: require scope on ALL item orchards).

---

## 6. Storage adapter — `apps/web/src/lib/storage.ts` (mirror `lib/psp.ts`/`lib/line.ts`)
```ts
export interface StorageAdapter { putImage(file: { name: string; bytes: Buffer | Uint8Array; contentType: string }): Promise<{ url: string }>; }
export function getStorage(): StorageAdapter   // switch(process.env.STORAGE_PROVIDER ?? "local")
```
- `local` (default): write to `apps/web/public/uploads/<uuid>-<name>`, return `{ url: "/uploads/<...>" }`. No bucket creds; build/tests work offline.
- `s3` (env-gated, deferred): throw loud if selected without creds (mirror psp/line "no silent fallback"). NOT implemented in P4 beyond the throw.
- Store the returned `url` only in `DeliveryImage.url` (bug #7 — never binary in DB).
- Env vars: `STORAGE_PROVIDER` (`local`|`s3`), `STORAGE_LOCAL_DIR` (default `public/uploads`), `S3_BUCKET`/`S3_REGION`/`S3_ACCESS_KEY_ID`/`S3_SECRET_ACCESS_KEY` (deferred). Add `public/uploads/.gitkeep`, gitignore the contents.

---

## 7. Screens (roadmap §7.2 P4; reuse P1/P3 patterns)
LIFF (`src/app/(liff)/**`, client components, verified-line):
- `order/[id]/reschedule` — buyer proposes new date OR confirms/declines an orchard proposal (confirm-from-plant/customer).
- `order/[id]/adjust` — adjust/increase volume per item; on INCREASE-approved, deep-link to pay.
- `order/[id]/increase-pay/[ipid]` — checkout-poll (clone of P1 `order/[id]/pay`).
- `order/[id]/review` — star rating + comment (only when DELIVERED).
Admin (`src/app/(admin)/admin/**`, JWT):
- `orders/[id]` detail extend: reschedule decide, adjustment propose/decide/cancel panels.
- `orders/[id]/delivery` — create delivery, upload proof images (multipart), mark delivered. Ops/CX uploads proof (roadmap §4: logistics/CX, not orchard).

---

## 8. Test plan
Unit (DB-free, vitest, alongside `__tests__/money.test.ts`):
- `fulfillment.test.ts`: transition guards — reschedule P->A/R only; adjustment P->A/R/C only; increase-pay P->S/E/C only; illegal transitions throw/return false. (Extract pure guard fns into `lib/fulfillment.ts` so they're testable without a DB — mirror `lib/orders.ts` `isOrderExpired`.)
- `adjust-money.test.ts`: REDUCE refund = `deltaQty*price` item-grain; INCREASE pay-more = `deltaQty*price`; multi-lot recompute of subTotal/fee/vat/transfer; `transfer = total-fee-vat-refundIntent`.
- `rating.test.ts`: avg recompute (0 reviews=0; mixed ratings -> rounded avg).
Integration (`describe.skip` unless `LIVE_DB`, mirror `qc.integration.test.ts`):
- `fulfillment.integration.test.ts`: reschedule approve flips `Order.deliveryDate`; reschedule reject(unfulfillable) -> CANCELLED + refundIntent; adjust REDUCE records refund-intent + recomputes totals; adjust INCREASE creates IncreasePayment(PENDING); increase-pay mock-PSP callback -> SUCCEEDED; delivery proof writes DeliveryImage rows + Delivery.IN_TRANSIT; deliver requires >=1 image then Order->DELIVERED; review recomputes `Orchard.rating`; perm-missing -> 403; expired increase-payment -> 410.

---

## 9. Migration
- `cd apps/web && npx prisma migrate dev --name phase4` (DIRECT_URL via `prisma.config.ts`; datasource block untouched — provider stays inline `postgresql`, url from config).
- Migration name format follows existing (`20260626144819_phase3`) — Prisma auto-timestamps `<ts>_phase4`.
- Fallback if migrate can't reach DB: `npx prisma migrate diff --from-schema-datasource prisma/schema.prisma --to-schema-datamodel prisma/schema.prisma --script > phase4.sql`, then `prisma db execute --file phase4.sql`, then `prisma migrate resolve --applied <name>`.
- After migrate: `npm run seed` (adds 3 perms), then `LIVE_DB=1 npx vitest run` for integration. New Order/Review fields are additive + defaulted -> safe on existing rows.

---

## 10. Acceptance criteria (numbered, for QA)
1. `prisma validate` passes; all back-relations resolve; `migrate dev --name phase4` applies clean on a P3 DB.
2. Orchard reschedule proposal creates PENDING row + pushes buyer; buyer-side proposal pushes orchard. A second PENDING proposal supersedes the prior (prior -> REJECTED) in one tx.
3. Buyer/operator APPROVE reschedule sets `Order.deliveryDate=proposedDate`; REJECT of unfulfillable order sets `Order.status=CANCELLED` and accumulates full refund intent. No auto-approve path exists.
4. Adjustment REDUCE approve: `OrderItem.quantity` decremented, `subTotal/fee/vat/totalAmount/transferAmount` recomputed item-grain, `Order.refundIntentAmount += deltaQty*price`. No `Refund` row, no PSP call (P5 boundary).
5. Adjustment INCREASE approve: qty incremented, totals recomputed, an `IncreasePayment(PENDING, amount=deltaQty*price, expiresAt=now+1h)` created. Guard: INCREASE rejected if `deltaQty > lot available`; REDUCE rejected if `deltaQty > orderItem.quantity`.
6. Increase-payment pay returns a mock PSP `paymentUrl`; success callback (HMAC-verified, `IP-` invoice) flips IncreasePayment `PENDING->SUCCEEDED` + `paidAt`, atomic with PaymentCallbackLog write. Expired increase-payment pay -> 410.
7. All approval/decide mutations require human auth: admin perm (`fulfillment.reschedule`/`fulfillment.adjust`/`delivery.write`) with orchard scope, or verified-line buyer owning the order. Missing perm -> 403; bad/no JWT -> 401.
8. Delivery proof upload stores image **URL/path only** via `getStorage()` (local mode, no bucket creds) — DB holds no binary; `DeliveryImage` rows created; `Delivery.IN_TRANSIT` + `proofUploadedBy` set.
9. Mark-delivered requires >=1 DeliveryImage; flips `Delivery.DELIVERED`+`deliveredAt` and `Order.PREPARING->DELIVERED` in one tx; pushes buyer.
10. Review allowed only when `Order.status=DELIVERED` and buyer owns order; one review per order; insert recomputes `Orchard.rating` = avg of its reviews, in the same tx.
11. Every money/state-flip handler wraps mutations in `prisma.$transaction`; partial writes impossible (kill-mid-tx test leaves DB consistent).
12. Default `npx vitest run` is DB-free and green; `LIVE_DB=1` integration suite exercises ACs 2-10.

## Alternatives Considered
1. Adjustment at ORDER grain (single delta) — Trade-off: simpler math, but breaks multi-lot cart refund/pay-more (roadmap §11.2); wrong refund per item. Rejected.
2. Full `Refund` table + PSP refund in P4 — Trade-off: complete money loop now, but violates Gate 0 (no real funds pre-legal) and roadmap §3.4 puts Refund in P5. Rejected.
3. Chosen — item-grain `OrderAdjustment` + refund-INTENT recorded on the adjustment, deferring `Refund`/payout to P5. Why: correct item math, zero real-money movement, clean P5 handoff via `Order.refundIntentAmount` already netted into `transferAmount`.

KISS gate: simplest correct shape is one table per concern (reschedule/adjust/increase-pay/delivery/image) + reuse of existing `money.ts`/`order-no.ts`/`psp.ts`/`rbac.ts`/push relay; no new abstractions beyond `lib/storage.ts` (required by convention) and pure guard fns in `lib/fulfillment.ts` (for unit-testability). No event bus, no generic state-machine framework.

Cross-cutting scan: Security (HMAC-before-DB on increase-pay callback; perm+scope on every admin route; upload size/type guard 413) -> covered. DB/Scale (all money in $tx; FK indexes added) -> covered. Compliance/Money (Gate 0 respected: mock PSP only, refund-intent not movement) -> flagged to owner via §1 boundary. Cost/i18n/a11y -> no new owners.
