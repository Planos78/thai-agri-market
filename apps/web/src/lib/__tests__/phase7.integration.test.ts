import { describe, it, expect, afterAll } from "vitest";
import { prisma } from "@/lib/db";
import { runExpirySweep } from "@/lib/expiry-sweep";
import { claimCronPeriod } from "@/lib/cron";
import { GET as revenueGET } from "@/app/api/admin/reports/revenue/route";
import { GET as reconGET } from "@/app/api/admin/reports/reconciliation/route";
import { signAdminJwt } from "@/lib/auth";

// P7 DB-dependent ACs (2/3/5/7). Gate on LIVE_DB so the default unit suite stays DB-free.
// Run: set -a && . ./.env && set +a && LIVE_DB=1 npx vitest run.
const live = process.env.LIVE_DB ? describe : describe.skip;

const TAG = "VITEST-P7-";

async function adminToken(): Promise<string> {
  const admin = await prisma.adminUser.findFirstOrThrow({ include: { role: { include: { permissions: { include: { permission: true } } } } } });
  const perms = admin.role.permissions.map((p) => p.permission.code);
  return signAdminJwt({ sub: admin.id, email: admin.email, perms });
}

async function findSeed() {
  const orchard = await prisma.orchard.findFirstOrThrow({ where: { name: "สวนทุเรียนลุงสมชาย" } });
  const durianLot = await prisma.lot.findFirstOrThrow({ where: { orchardId: orchard.id, fruitName: "ทุเรียน" } });
  const buyer = await prisma.user.findUniqueOrThrow({ where: { lineUserId: "mock-buyer-1" } });
  return { orchard, durianLot, buyer };
}

live("phase 7 cron + reports (needs DB)", () => {
  const orderIds: string[] = [];
  const cronPeriods: string[] = [];

  afterAll(async () => {
    for (const id of orderIds) {
      await prisma.payoutBatchOrder.deleteMany({ where: { orderId: id } });
      await prisma.refund.deleteMany({ where: { orderId: id } });
      await prisma.payment.deleteMany({ where: { orderId: id } });
      await prisma.orderItem.deleteMany({ where: { orderId: id } });
      await prisma.order.deleteMany({ where: { id } });
    }
    await prisma.cronLog.deleteMany({ where: { task: { in: ["expiry-sweep-test"] } } });
    void cronPeriods;
    await prisma.$disconnect();
  }, 60_000);

  // AC2/AC3: expiry-sweep flips an expired WAITING_PAYMENT order; 2nd run sweeps 0 (idempotent).
  it("expiry-sweep flips expired order -> EXPIRED + payment FAILED/REFUNDED; idempotent 2nd run", async () => {
    const { durianLot, buyer } = await findSeed();
    const orderNo = `${TAG}EXP-${Date.now()}`;
    const order = await prisma.order.create({
      data: {
        orderNo,
        buyerId: buyer.id,
        subTotal: 900,
        totalAmount: 900,
        status: "WAITING_PAYMENT",
        shippingAddress: "vitest",
        paymentExpiredAt: new Date(Date.now() - 60_000), // already expired
        items: { create: [{ lotId: durianLot.id, quantity: 5, price: 180 }] },
        payment: { create: { amount: 900, status: "PENDING", escrowStatus: "HELD" } },
      },
    });
    orderIds.push(order.id);

    const r1 = await runExpirySweep(new Date());
    expect(r1.ids).toContain(order.id);

    const o = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(o.status).toBe("EXPIRED");
    const p = await prisma.payment.findUniqueOrThrow({ where: { orderId: order.id } });
    expect(p.status).toBe("FAILED");
    expect(p.escrowStatus).toBe("REFUNDED");

    // 2nd run: this order no longer selected (idempotent).
    const r2 = await runExpirySweep(new Date());
    expect(r2.ids).not.toContain(order.id);
  });

  it("expiry-sweep never touches a PAID order", async () => {
    const { durianLot, buyer } = await findSeed();
    const order = await prisma.order.create({
      data: {
        orderNo: `${TAG}PAID-${Date.now()}`,
        buyerId: buyer.id,
        subTotal: 900,
        totalAmount: 900,
        status: "PAID",
        shippingAddress: "vitest",
        paymentExpiredAt: new Date(Date.now() - 60_000),
        items: { create: [{ lotId: durianLot.id, quantity: 5, price: 180 }] },
        payment: { create: { amount: 900, status: "COMPLETED", escrowStatus: "HELD" } },
      },
    });
    orderIds.push(order.id);
    const r = await runExpirySweep(new Date());
    expect(r.ids).not.toContain(order.id);
    const o = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(o.status).toBe("PAID");
  });

  // AC3: CronLog dedup — same (task,period) -> skipped; distinct period -> runs.
  it("CronLog dedup: same period skips, new period claims", async () => {
    const period = `P7-${Date.now()}`;
    const first = await claimCronPeriod("expiry-sweep-test", period);
    expect(first.skipped).toBe(false);
    const second = await claimCronPeriod("expiry-sweep-test", period);
    expect(second.skipped).toBe(true);
    const other = await claimCronPeriod("expiry-sweep-test", `${period}-b`);
    expect(other.skipped).toBe(false);
  });

  // AC7: revenue report sums match a hand-seeded paid order.
  it("revenue report returns exact sums for a paid order in window", async () => {
    const { durianLot, buyer } = await findSeed();
    const paidAt = new Date();
    const order = await prisma.order.create({
      data: {
        orderNo: `${TAG}REV-${Date.now()}`,
        buyerId: buyer.id,
        subTotal: 1000,
        feeAmount: 100,
        vatFeeAmount: 7,
        totalAmount: 1000,
        status: "PAID",
        shippingAddress: "vitest",
        paidAt,
        items: { create: [{ lotId: durianLot.id, quantity: 5, price: 200 }] },
        payment: { create: { amount: 1000, status: "COMPLETED", escrowStatus: "HELD" } },
      },
    });
    orderIds.push(order.id);

    const day = paidAt.toISOString().slice(0, 10);
    const token = await adminToken();
    const res = await revenueGET(
      new Request(`http://test/api/admin/reports/revenue?from=${day}&to=${day}`, {
        headers: { authorization: `Bearer ${token}` },
      }),
    );
    expect(res.status).toBe(200);
    const d = await res.json();
    expect(d.totals.subTotal).toBeGreaterThanOrEqual(1000);
    expect(d.totals.feeAmount).toBeGreaterThanOrEqual(100);
  });

  // AC5: reconciliation route returns a variance number + per-order rows.
  it("reconciliation route returns totals + rows with variance field", async () => {
    const day = new Date().toISOString().slice(0, 10);
    const token = await adminToken();
    const res = await reconGET(
      new Request(`http://test/api/admin/reports/reconciliation?from=${day}&to=${day}`, {
        headers: { authorization: `Bearer ${token}` },
      }),
    );
    expect(res.status).toBe(200);
    const d = await res.json();
    expect(d.totals).toHaveProperty("variance");
    expect(Array.isArray(d.rows)).toBe(true);
  });

  // AC8: report routes 401 without JWT.
  it("revenue 401 without JWT", async () => {
    const day = new Date().toISOString().slice(0, 10);
    const res = await revenueGET(new Request(`http://test/api/admin/reports/revenue?from=${day}&to=${day}`));
    expect(res.status).toBe(401);
  });
});
