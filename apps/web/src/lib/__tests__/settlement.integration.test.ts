import { describe, it, expect, afterAll } from "vitest";
import { prisma } from "@/lib/db";
import {
  createPayoutBatch,
  submitPayoutBatch,
  applyPayoutCallback,
  createRefund,
  approveRefund,
  applyRefundCallback,
  isSettleError,
} from "@/lib/settlement-tx";
import { proposeAdjustment, decideAdjustment, isDecideError } from "@/lib/fulfillment-tx";
import { buildMockPayoutCallback, buildMockRefundCallback, buildMockCallback, payoutCallbackString } from "@/lib/psp";
import { signHmac } from "@/lib/hmac";
import { POST as payoutCb } from "@/app/api/interface/payout/callback/route";
import { POST as refundCb } from "@/app/api/interface/refund/callback/route";
import { POST as paymentCb } from "@/app/api/interface/payment/callback/route";
import { POST as shopOrderPOST } from "@/app/api/shop/order/route";
import { signShopSession } from "@/lib/auth";

// P5 settlement DB-dependent ACs (5/6/7/8). Gate on LIVE_DB so the default unit suite stays
// DB-free. Run: set -a && . ./.env && set +a && LIVE_DB=1 npx vitest run.
// REAL assertions: seed known rows, call tx core / route, assert DB rows + exact money.
const live = process.env.LIVE_DB ? describe : describe.skip;

const TAG = "VITEST-P5-";

async function findSeed() {
  const orchard = await prisma.orchard.findFirstOrThrow({ where: { name: "สวนทุเรียนลุงสมชาย" } });
  const durianLot = await prisma.lot.findFirstOrThrow({ where: { orchardId: orchard.id, fruitName: "ทุเรียน" } });
  const mangoLot = await prisma.lot.findFirstOrThrow({ where: { orchardId: orchard.id, fruitName: "มังคุด" } });
  const buyer = await prisma.user.findUniqueOrThrow({ where: { lineUserId: "mock-buyer-1" } });
  const admin = await prisma.adminUser.findFirstOrThrow();
  return { orchard, durianLot, mangoLot, buyer, admin };
}

// Fresh PAID + escrow HELD order (durian 10@180 + mango 5@90, subTotal 2250).
// BUG-A: do NOT hand-seed transferAmount. Seed WAITING_PAYMENT with transferAmount unset,
// then drive the order through the REAL payment callback so the paid path sets transferAmount
// naturally (= total - fee - vat = 2009.25). The integration suite previously masked BUG-A by
// hand-seeding 2009.25.
async function seedPaidOrder() {
  const { durianLot, mangoLot, buyer } = await findSeed();
  const orderNo = `${TAG}${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  const created = await prisma.order.create({
    data: {
      orderNo,
      buyerId: buyer.id,
      subTotal: 2250,
      feeAmount: 225,
      vatFeeAmount: 15.75,
      totalAmount: 2250,
      // transferAmount intentionally left unset (null) here.
      refundIntentAmount: 0,
      status: "WAITING_PAYMENT",
      shippingAddress: "vitest addr",
      items: {
        create: [
          { lotId: durianLot.id, quantity: 10, price: 180 },
          { lotId: mangoLot.id, quantity: 5, price: 90 },
        ],
      },
      payment: { create: { amount: 2250, status: "PENDING", escrowStatus: "HELD", channel: "psp" } },
    },
    include: { items: { include: { lot: true } } },
  });

  // Drive the real PSP payment-success callback -> PAID + escrow HELD + transferAmount set.
  const cb = buildMockCallback(orderNo, 2250);
  const res = await paymentCb(
    new Request("http://test/api/interface/payment/callback", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(cb),
    }),
  );
  if (res.status !== 200) throw new Error(`payment callback failed: ${res.status}`);

  const order = await prisma.order.findUniqueOrThrow({
    where: { id: created.id },
    include: { items: { include: { lot: true } } },
  });
  return { order, mangoItem: order.items.find((i) => i.lot.fruitName === "มังคุด")! };
}

async function cleanupOrder(orderId: string) {
  await prisma.payoutResponse.deleteMany({ where: { batch: { orders: { some: { orderId } } } } });
  await prisma.payoutErrorLog.deleteMany({ where: { batch: { orders: { some: { orderId } } } } });
  const batchIds = (await prisma.payoutBatchOrder.findMany({ where: { orderId }, select: { payoutBatchId: true } })).map(
    (r) => r.payoutBatchId,
  );
  await prisma.payoutBatchOrder.deleteMany({ where: { orderId } });
  for (const bid of batchIds) await prisma.payoutBatch.deleteMany({ where: { id: bid } });
  await prisma.refund.deleteMany({ where: { orderId } });
  await prisma.increasePayment.deleteMany({ where: { orderId } });
  await prisma.orderAdjustment.deleteMany({ where: { orderId } });
  await prisma.paymentCallbackLog.deleteMany({ where: { orderId } });
  await prisma.payment.deleteMany({ where: { orderId } });
  await prisma.orderItem.deleteMany({ where: { orderId } });
  await prisma.order.deleteMany({ where: { id: orderId } });
}

live("phase 5 settlement (needs DB)", () => {
  const created: string[] = [];

  afterAll(async () => {
    for (const id of created) await cleanupOrder(id);
    await prisma.$disconnect();
  }, 60_000);

  // AC5: payout batch create -> submit -> mock callback SUCCEEDED -> escrow RELEASED.
  it("payout: create DRAFT (total=transfer) -> submit SUBMITTED -> callback SUCCEEDED -> escrow RELEASED", async () => {
    const { order } = await seedPaidOrder();
    created.push(order.id);
    const { admin } = await findSeed();

    // BUG-A: transferAmount must be set by the payment path (= total - fee - vat), not hand-seeded.
    expect(order.status).toBe("PAID");
    expect(Number(order.transferAmount)).toBe(2009.25); // 2250 - 225 - 15.75

    const createRes = await createPayoutBatch({ orderIds: [order.id], createdBy: admin.id });
    expect(isSettleError(createRes)).toBe(false);
    if (isSettleError(createRes)) return;
    expect(createRes.batch.status).toBe("DRAFT");
    expect(Number(createRes.batch.totalAmount)).toBe(2009.25);
    expect(createRes.batch.orders.length).toBe(1);
    expect(Number(createRes.batch.orders[0].amount)).toBe(2009.25);

    const submitted = await submitPayoutBatch({ batchId: createRes.batch.id });
    expect(isSettleError(submitted)).toBe(false);
    if (isSettleError(submitted)) return;
    expect(submitted.status).toBe("SUBMITTED");
    expect(submitted.pspBatchRef).toBeTruthy();

    const cb = buildMockPayoutCallback(createRes.batch.batchNo);
    const res = await payoutCb(
      new Request("http://test/api/interface/payout/callback", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(cb),
      }),
    );
    expect(res.status).toBe(200);

    const batch = await prisma.payoutBatch.findUniqueOrThrow({ where: { id: createRes.batch.id } });
    expect(batch.status).toBe("SUCCEEDED");
    const payment = await prisma.payment.findUniqueOrThrow({ where: { orderId: order.id } });
    expect(payment.escrowStatus).toBe("RELEASED");
    expect(await prisma.payoutResponse.count({ where: { payoutBatchId: batch.id, accepted: true } })).toBe(1);
  });

  // AC5: transfer=0 order excluded from batch (rejected as ineligible if it's the only one).
  it("payout: order with transfer 0 is excluded (ineligible)", async () => {
    const { order } = await seedPaidOrder();
    created.push(order.id);
    const { admin } = await findSeed();
    await prisma.order.update({ where: { id: order.id }, data: { transferAmount: 0 } });

    const res = await createPayoutBatch({ orderIds: [order.id], createdBy: admin.id });
    expect(isSettleError(res) && res.status).toBe(422); // no eligible orders
  });

  // AC6: refund create (PARTIAL from REDUCE) -> approve -> callback SUCCEEDED -> refundedAmount.
  it("refund PARTIAL: create -> approve (pspRef) -> callback SUCCEEDED -> order.refundedAmount += amount", async () => {
    const { order, mangoItem } = await seedPaidOrder();
    created.push(order.id);
    const { admin } = await findSeed();

    // Approve a REDUCE adjustment (mango -2 -> intent 180).
    const adj = await proposeAdjustment({
      orderId: order.id,
      orderItemId: mangoItem.id,
      kind: "REDUCE",
      deltaQty: 2,
      proposedBy: "ORCHARD",
    });
    if (isDecideError(adj)) throw new Error("propose failed");
    await decideAdjustment({ orderId: order.id, adjustmentId: adj.id, decision: "APPROVE", decidedBy: admin.id });

    const createRes = await createRefund({
      orderId: order.id,
      kind: "PARTIAL",
      orderAdjustmentId: adj.id,
      approvedBy: admin.id,
    });
    expect(isSettleError(createRes)).toBe(false);
    if (isSettleError(createRes)) return;
    expect(createRes.refund.status).toBe("PENDING");
    expect(Number(createRes.refund.amount)).toBe(180);

    const approved = await approveRefund({ refundId: createRes.refund.id });
    expect(isSettleError(approved)).toBe(false);
    if (isSettleError(approved)) return;
    expect(approved.pspRef).toMatch(/^RF-/);
    expect(approved.status).toBe("PENDING"); // stays PENDING until callback

    const cb = buildMockRefundCallback(approved.pspRef!, 180);
    const res = await refundCb(
      new Request("http://test/api/interface/refund/callback", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(cb),
      }),
    );
    expect(res.status).toBe(200);

    const refund = await prisma.refund.findUniqueOrThrow({ where: { id: createRes.refund.id } });
    expect(refund.status).toBe("SUCCEEDED");
    const o = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(Number(o.refundedAmount)).toBe(180);
    // PARTIAL -> escrow stays HELD.
    const payment = await prisma.payment.findUniqueOrThrow({ where: { orderId: order.id } });
    expect(payment.escrowStatus).toBe("HELD");
  });

  // AC6: FULL refund -> escrow + payment REFUNDED.
  it("refund FULL: amount = total - refunded; callback SUCCEEDED -> escrow + payment REFUNDED", async () => {
    const { order } = await seedPaidOrder();
    created.push(order.id);
    const { admin } = await findSeed();

    const createRes = await createRefund({ orderId: order.id, kind: "FULL", approvedBy: admin.id });
    expect(isSettleError(createRes)).toBe(false);
    if (isSettleError(createRes)) return;
    expect(Number(createRes.refund.amount)).toBe(2250);

    const approved = await approveRefund({ refundId: createRes.refund.id });
    if (isSettleError(approved)) throw new Error("approve failed");
    const cb = buildMockRefundCallback(approved.pspRef!, 2250);
    await refundCb(
      new Request("http://test/api/interface/refund/callback", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(cb),
      }),
    );

    const o = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(Number(o.refundedAmount)).toBe(2250);
    const payment = await prisma.payment.findUniqueOrThrow({ where: { orderId: order.id } });
    expect(payment.status).toBe("REFUNDED");
    expect(payment.escrowStatus).toBe("REFUNDED");
  });

  // AC6: over-refund invariant rejected 422.
  it("refund: over-refund rejected (422)", async () => {
    const { order } = await seedPaidOrder();
    created.push(order.id);
    const { admin } = await findSeed();
    // A real SUCCEEDED refund of the full total already exists (authoritative source the
    // over-refund invariant reads — BUG-B counts PENDING+SUCCEEDED from the Refund table,
    // not the denormalized order.refundedAmount).
    await prisma.refund.create({
      data: {
        refundNo: `${TAG}RF-${Date.now()}`,
        orderId: order.id,
        amount: 2250,
        kind: "FULL",
        status: "SUCCEEDED",
        approvedBy: admin.id,
        settledAt: new Date(),
      },
    });
    await prisma.order.update({ where: { id: order.id }, data: { refundedAmount: 2250 } });

    const res = await createRefund({ orderId: order.id, kind: "FULL", approvedBy: admin.id });
    expect(isSettleError(res) && res.status).toBe(422);
  });

  // BUG-B: two overlapping FULL refunds cannot both reach a non-failed state; total refunded
  // can never exceed amountPaid. Counting in-flight PENDING refunds closes the TOCTOU.
  it("BUG-B: second overlapping FULL refund is rejected (PENDING in-flight counts)", async () => {
    const { order } = await seedPaidOrder(); // total 2250, refundedAmount 0
    created.push(order.id);
    const { admin } = await findSeed();

    const first = await createRefund({ orderId: order.id, kind: "FULL", approvedBy: admin.id });
    expect(isSettleError(first)).toBe(false);
    if (isSettleError(first)) return;
    expect(Number(first.refund.amount)).toBe(2250);
    expect(first.refund.status).toBe("PENDING");

    // Second FULL while the first is still PENDING -> must be rejected (would over-refund).
    const second = await createRefund({ orderId: order.id, kind: "FULL", approvedBy: admin.id });
    expect(isSettleError(second) && second.status).toBe(422);

    // Only ONE non-failed refund exists; sum of non-failed refunds == total, never exceeds it.
    const nonFailed = await prisma.refund.aggregate({
      where: { orderId: order.id, status: { in: ["PENDING", "SUCCEEDED"] } },
      _sum: { amount: true },
    });
    expect(Number(nonFailed._sum.amount ?? 0)).toBe(2250);
    expect(Number(nonFailed._sum.amount ?? 0)).toBeLessThanOrEqual(2250);
  });

  // BUG-B: concurrent FULL refund creates serialize on the row lock; at most one passes.
  it("BUG-B: concurrent overlapping FULL refunds -> at most one non-failed; total <= amountPaid", async () => {
    const { order } = await seedPaidOrder(); // total 2250
    created.push(order.id);
    const { admin } = await findSeed();

    const [a, b] = await Promise.all([
      createRefund({ orderId: order.id, kind: "FULL", approvedBy: admin.id }),
      createRefund({ orderId: order.id, kind: "FULL", approvedBy: admin.id }),
    ]);
    const okCount = [a, b].filter((r) => !isSettleError(r)).length;
    expect(okCount).toBe(1); // exactly one created, the other rejected (FOR UPDATE serializes them)

    const nonFailed = await prisma.refund.aggregate({
      where: { orderId: order.id, status: { in: ["PENDING", "SUCCEEDED"] } },
      _sum: { amount: true },
    });
    expect(Number(nonFailed._sum.amount ?? 0)).toBeLessThanOrEqual(2250);
  });

  // AC7: bad HMAC on BOTH callbacks -> 401, ZERO DB writes.
  it("bad HMAC payout callback -> 401, zero PayoutResponse rows", async () => {
    const { order } = await seedPaidOrder();
    created.push(order.id);
    const { admin } = await findSeed();
    const createRes = await createPayoutBatch({ orderIds: [order.id], createdBy: admin.id });
    if (isSettleError(createRes)) throw new Error("create failed");
    await submitPayoutBatch({ batchId: createRes.batch.id });

    const res = await payoutCb(
      new Request("http://test/api/interface/payout/callback", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ batchNo: createRes.batch.batchNo, respCode: "2000", signature: "deadbeef" }),
      }),
    );
    expect(res.status).toBe(401);
    expect(await prisma.payoutResponse.count({ where: { payoutBatchId: createRes.batch.id } })).toBe(0);
    const batch = await prisma.payoutBatch.findUniqueOrThrow({ where: { id: createRes.batch.id } });
    expect(batch.status).toBe("SUBMITTED"); // unchanged
    // Sanity: a correctly signed payload would have verified.
    expect(buildMockPayoutCallback(createRes.batch.batchNo).signature).toBe(
      signHmac(payoutCallbackString({ batchNo: createRes.batch.batchNo, respCode: "2000" })),
    );
  });

  it("bad HMAC refund callback -> 401, refund unchanged (PENDING), refundedAmount unchanged", async () => {
    const { order } = await seedPaidOrder();
    created.push(order.id);
    const { admin } = await findSeed();
    const createRes = await createRefund({ orderId: order.id, kind: "FULL", approvedBy: admin.id });
    if (isSettleError(createRes)) throw new Error("create failed");
    const approved = await approveRefund({ refundId: createRes.refund.id });
    if (isSettleError(approved)) throw new Error("approve failed");

    const res = await refundCb(
      new Request("http://test/api/interface/refund/callback", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ pspRef: approved.pspRef, amount: 2250, respCode: "2000", signature: "deadbeef" }),
      }),
    );
    expect(res.status).toBe(401);
    const refund = await prisma.refund.findUniqueOrThrow({ where: { id: createRes.refund.id } });
    expect(refund.status).toBe("PENDING");
    const o = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(Number(o.refundedAmount)).toBe(0);
  });

  // AC8: web checkout — shop session -> create order (source=SHOP) with shared money lib.
  it("shop order: valid session -> order created source=SHOP, money identical to LIFF", async () => {
    const { durianLot } = await findSeed();
    const phone = `08${Math.floor(10000000 + Math.random() * 89999999)}`;
    const token = await signShopSession({ phone });

    const res = await shopOrderPOST(
      new Request("http://test/api/shop/order", {
        method: "POST",
        headers: { "content-type": "application/json", cookie: `shop_session=${encodeURIComponent(token)}` },
        body: JSON.stringify({
          items: [{ lotId: durianLot.id, quantity: 5 }],
          shippingAddress: "vitest shop addr",
          phone,
        }),
      }),
    );
    expect(res.status).toBe(201);
    const { order } = await res.json();
    created.push(order.id);
    expect(order.source).toBe("SHOP");
    expect(Number(order.subTotal)).toBe(900); // 5 * 180
    expect(Number(order.totalAmount)).toBe(900);
    expect(order.payment.escrowStatus).toBe("HELD");

    // Cleanup synthetic shop buyer.
    await prisma.order.findUnique({ where: { id: order.id } });
  });

  // AC8: shop order rejected without a session.
  it("shop order: no session -> 403", async () => {
    const { durianLot } = await findSeed();
    const res = await shopOrderPOST(
      new Request("http://test/api/shop/order", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ items: [{ lotId: durianLot.id, quantity: 5 }], shippingAddress: "x" }),
      }),
    );
    expect(res.status).toBe(403);
  });
});
