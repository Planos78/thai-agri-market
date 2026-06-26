# QA: Phase 4 - Fulfillment (VERIFY)
Date: 2026-06-27 | Role: QA | Independent adversarial verification | Branch: main (P4 uncommitted on disk)
Verdict: SHIP WITH ONE NON-BLOCKING FIX (feature code passes all 12 ACs; the "integration test" deliverable is empty stubs - see BUG-1)

All commands re-run fresh against the live Supabase DB (migration 20260626152227_phase4 already applied). Dev server run on port 3100 (mock PSP/LINE/SMS, local storage); port-3000 Docker app left untouched.

## Gates (re-run, real output)
- `npx tsc --noEmit` -> exit 0, 0 errors.
- `npx vitest run` -> 12 files passed, 4 skipped; 62 tests passed, 23 skipped, 0 failed. Matches developer claim.
- `npx next build` -> exit 0. All 14 P4 API routes registered, no collisions, admin routes all under `/api/admin/*` + pages under `/admin/*`. Confirmed present:
  admin reschedule (#1), reschedule decide (#4), adjustments (#5), adjustments decide (#7), adjustments cancel (#8), delivery (#11), delivery/proof (#12), delivery/deliver (#13); liff reschedule (#2), reschedule decide (#3), adjustments (#6), increase-payment pay (#9), review (#14); interface/payment/callback (#10).

## Environment confirmed
PSP_PROVIDER=mock, LINE_PROVIDER=mock, SMS_PROVIDER=mock, PLATFORM_TAKE_RATE=0.10, VAT_RATE=0.07, STORAGE_PROVIDER unset (local default). Admin creds admin@thaiagri.local / admin1234 (10 perms incl. fulfillment.reschedule, fulfillment.adjust, delivery.write). Verified buyer lineUserId=mock-buyer-1 (User id 76903ddd-..., role BUYER). Money note: VAT is charged on the platform fee, not the subtotal (fee = subTotal*0.10; vat = fee*0.07).

## Per-AC results (curl HTTP codes + DB row inspection + real money numbers)

AC1 - Schema/migrate clean. PASS. `prisma migrate status` = "Database schema is up to date", 4 migrations, no drift. `prisma validate` implicit (seed + generate + build all succeed).

AC2 - Reschedule propose + supersede. PASS. Admin ORCHARD proposal -> 201 PENDING. Second proposal -> 201 PENDING; first auto-flipped to REJECTED in the same tx (verified RID1=REJECTED, RID2=PENDING). Buyer-side LIFF proposal -> 201 with proposedBy=BUYER.

AC3 - Reschedule decide. PASS.
- APPROVE -> 200, Order.deliveryDate set to proposedDate (2026-07-15), Order.status stays PAID, decidedBy=admin sub. Re-decide of an APPROVED row -> 409 (no double-decide).
- REJECT + unfulfillable -> 200, Order.status=CANCELLED, refundIntentAmount=900 (full total), transferAmount=-96.30 (=900-90-6.30-900). HUMAN-only confirmed: no cron/auto-approve route exists; every decide requires admin perm or verified-line buyer.

AC4 - Adjustment REDUCE (item grain). PASS. Order durian 10@180 + mango 5@90 (subTotal 2250). REDUCE mango deltaQty=2 -> approve -> mango qty 3, durian unchanged 10. subTotal 2070, fee 207, vat 14.49, total 2070, refundIntentAmount 180 (=2*90), transferAmount 1668.51 (=2070-207-14.49-180). OrderAdjustment APPROVED, amount 180. NO Refund row, no PSP call. (Refund table does not exist in DB - confirmed via information_schema.)

AC5 - Adjustment INCREASE + guards. PASS. INCREASE durian deltaQty=4 -> approve -> durian qty 14. subTotal 2790, fee 279, vat 19.53, total 2790, refundIntent unchanged 180, transferAmount 2311.47 (=2790-279-19.53-180). IncreasePayment PENDING, amount 720 (=4*180), pspRef IP-S260627001, expiresAt ~now+60min. Guards: INCREASE deltaQty=99999 > lot(500) -> 422 at decide; REDUCE deltaQty=999 > item qty -> 422 at propose.

AC6 - Increase-pay + IP- callback. PASS.
- Pay -> 200 {paymentUrl:"/mock-psp/pay?invoice=IP-S260627001&amount=720", invoiceNo:"IP-S260627001", amount:720}. Wrong buyer -> 403.
- Bad-HMAC callback (signature=deadbeef) -> 401, IP stays PENDING, ZERO PaymentCallbackLog rows written (HMAC verified before any DB access - confirmed by count=0).
- Valid-HMAC callback (sig over "IP-S260627001|720|2000") -> 200, IP PENDING->SUCCEEDED + paidAt set, PaymentCallbackLog row accepted=true with tranRef, atomic.
- Expired IP (expiresAt forced to past) -> pay returns 410, IP flipped PENDING->EXPIRED (lazy expiry).

AC7 - RBAC (human auth). PASS. No token -> 401; garbage token -> 401. No-perm admin token (perms:[orders.read]) -> 403 on reschedule, adjustments, and delivery. Buyer review with non-verified lineUserId -> 403. Scope enforced via requireOrderScope (all orchards an order touches).

AC8 - Delivery proof URL-only. PASS. Create delivery -> Order PAID->PREPARING, Delivery PENDING. Upload PNG -> 201; DeliveryImage row columns = [id, deliveryId, url, uploadedAt] only - NO binary column; url="/uploads/<uuid>-proof.png"; file written to public/uploads on disk; Delivery.IN_TRANSIT + proofUploadedBy=admin sub. Storage adapter = local (no bucket creds).

AC9 - Mark delivered. PASS. Deliver before delivery exists -> 404. Deliver with 0 images -> 409. After 1 proof image: deliver -> 200, Delivery.DELIVERED + deliveredAt, Order PREPARING->DELIVERED, atomic.

AC10 - Review + rating recompute. PASS. Wrong buyer -> 403; rating=6 -> 422. Valid rating=4 on DELIVERED order -> 201, Review row created. Orchard.rating recomputed 0 -> 4.0 (avg of [4]) in the same tx. Duplicate review -> 409 (one per order).

AC11 - Atomicity. PASS (by construction + behavior). Every money/state-flip (decideReschedule, proposeReschedule supersede, decideAdjustment, cancelAdjustment, callback handleOrder/handleIncreasePay, proof, deliver, review) wraps mutations in prisma.$transaction. Observed: supersede (reject prior + create new) atomic; REDUCE/INCREASE qty+totals+refundIntent/IncreasePayment atomic; callback IP-flip + callbackLog atomic; deliver Delivery+Order atomic; review insert + rating recompute atomic. Bad-HMAC produced zero partial writes.

AC12 - Default DB-free vitest green; LIVE_DB integration. PARTIAL (see BUG-1). Default `vitest run` is DB-free and green (62 passed). BUT the LIVE_DB integration suite (fulfillment.integration.test.ts) is 12 EMPTY test bodies `it("...", () => {})` - zero assertions, zero DB calls (runs in 1ms). It "passes" trivially and provides NO coverage of ACs 2-10. The actual AC2-10 verification in this report was done by QA's own curl + direct-DB inspection, not by that suite.

## Regression (P1/P2/P3)
- P1: GET /api/liff/lots -> 200, 3 seeded RELEASED lots. PASS.
- P2: /admin/lots -> 200, /admin/orders -> 200 (admin pages serve). PASS.
- P3: Order WAITING_PAYMENT -> POST /api/dev/mock-pay -> callback -> Order PAID, Payment COMPLETED, escrow HELD; PushJob "payment-paid" enqueued (mock-buyer-1). PASS.
- P3 webhook: POST /api/line/webhook with no signature -> 200 in mock mode (LINE_PROVIDER=mock intentionally skips the check for dev). Prod enforcement (LINE_PROVIDER=line -> 401 bad sig) is correct in code and covered by webhook.test.ts (9 unit tests pass). PASS.

## Gate 0 (no real funds)
PASS. No Refund table in DB. REDUCE/reschedule-reject record refundIntentAmount only (no Refund row, no payout, no PSP refund call). Increase-pay uses mock PSP exclusively. All approvals HUMAN-only (admin perm or verified-line buyer).

## BUGS

BUG-1 (deliverable defect, non-blocking for feature ship, blocking for "tested" claim) - apps/web/src/lib/__tests__/fulfillment.integration.test.ts contains 12 placeholder tests with empty bodies (`it("...", () => {})`). They assert nothing and never touch the DB; the suite finishes in ~1ms whether or not LIVE_DB is set. The developer done-doc (line 14) and tech-lead AC12 both claim this suite "exercises ACs 2-10" - it does not. Repro: `LIVE_DB=1 npx vitest run src/lib/__tests__/fulfillment.integration.test.ts` -> "12 passed" with no real work. Impact: no automated regression coverage for the P4 money/state flows; future changes can silently break AC2-10 with the suite still green. Fix: implement real assertions in those bodies (create order -> call tx core / route -> assert DB rows + money numbers), or delete the empty stubs so they do not masquerade as coverage.

## OBSERVATIONS (not bugs)
- OBS-1: Full-order refund intent drives transferAmount negative (-96.30 in the reject-unfulfillable case = 900 - 90 - 6.30 - 900). Mathematically consistent with `transfer = total - fee - vat - refundIntent`, but a negative payout figure is a P5 concern when real refunds/payouts move. Flag to P5 owner; not a P4 defect (P4 records intent only).
- OBS-2: INCREASE adjustment can be approved on a DELIVERED order (decideAdjustment guards adjustment PENDING + lot stock, not Order.status). Did not exercise as a failure; noting as a possible business-rule gap (should INCREASE be blocked post-delivery?). Out of stated AC scope.
- OBS-3: `npm run seed` (bare tsx) lacks a dotenv loader and ECONNREFUSES; `npx prisma db seed` is the working path (matches developer note). Cosmetic.

## Cleanup
All QA-created rows deleted (3 orders QA-P4*/QA-P4B*/QA-P4C*, 4 orderItems, 3 payments, 4 adjustments, 3 reschedules, 2 increasePayments, 1 delivery, 1 deliveryImage, 1 review, 2 IP- callbackLogs, 14 pushJobs). Orchard "สวนทุเรียนลุงสมชาย".rating reset to 0. Uploaded proof image deleted from public/uploads (dir now holds only .gitkeep). Final sweep: 0 QA orders, total orders back to 6 baseline, all P4 tables 0 rows, rating 0, pushJobs 0. Dev server (PID 46661, port 3100) killed; port-3000 Docker app untouched. QA scratch dir .qa-tmp removed; no QA artifacts in git status. No source/schema files modified by QA.

## Per-AC summary table
| AC | Result | Evidence |
|----|--------|----------|
| 1 Schema/migrate clean | PASS | migrate status up-to-date; build/seed/generate OK |
| 2 Reschedule propose + supersede | PASS | 201/201; prior PENDING->REJECTED; buyer proposedBy=BUYER |
| 3 Reschedule decide (approve/reject-unfulfillable) | PASS | deliveryDate set; CANCELLED+refundIntent=900; 409 re-decide; human-only |
| 4 Adjustment REDUCE item-grain money | PASS | subTotal2070/fee207/vat14.49/refund180/transfer1668.51; no Refund |
| 5 Adjustment INCREASE + guards | PASS | qty14/subTotal2790/transfer2311.47; IP PENDING 720; 422 guards |
| 6 Increase-pay + IP- callback + expiry | PASS | 200 payUrl; bad-HMAC 401 zero-write; good-HMAC SUCCEEDED+log; 410 expired |
| 7 RBAC human auth | PASS | 401 no/bad token; 403 no-perm reschedule/adjust/delivery; 403 non-owner buyer |
| 8 Delivery proof URL-only | PASS | DeliveryImage url-only, file on disk, IN_TRANSIT, proofUploadedBy |
| 9 Mark delivered | PASS | 404 no-delivery; 409 no-image; DELIVERED + Order DELIVERED atomic |
| 10 Review + rating recompute | PASS | 403/422/201/409; Orchard.rating 0->4.0 in tx |
| 11 Atomicity ($transaction) | PASS | all flips in $tx; bad-HMAC zero partial write |
| 12 DB-free green + LIVE_DB integration | PARTIAL | default suite green; integration suite is empty stubs (BUG-1) |

OVERALL: 11/12 PASS, 1 PARTIAL (AC12 - empty integration stubs). Feature code is correct and ships. One non-blocking deliverable fix required (BUG-1: implement or remove the empty integration tests).
