import { describe, it, expect, afterAll } from "vitest";
import { prisma } from "@/lib/db";
import { getStorage } from "@/lib/storage";
import { createManifest, setPackedQtys, signOffManifest, isPackingError } from "@/lib/packing-tx";
import { fileClaim, triageClaim, resolveClaim, isClaimError } from "@/lib/claim-tx";
import { POST as paymentCb } from "@/app/api/interface/payment/callback/route";
import { buildMockCallback } from "@/lib/psp";

// P6 packing + claim DB-dependent ACs. Gate on LIVE_DB so the default unit suite stays DB-free.
// Run: set -a && . ./.env && set +a && LIVE_DB=1 npx vitest run.
// REAL assertions: seed known rows, call tx core, assert DB rows + claim->refund linkage.
const live = process.env.LIVE_DB ? describe : describe.skip;

const TAG = "VITEST-P6-";

async function findSeed() {
  const orchard = await prisma.orchard.findFirstOrThrow({ where: { name: "สวนทุเรียนลุงสมชาย" } });
  const durianLot = await prisma.lot.findFirstOrThrow({ where: { orchardId: orchard.id, fruitName: "ทุเรียน" } });
  const mangoLot = await prisma.lot.findFirstOrThrow({ where: { orchardId: orchard.id, fruitName: "มังคุด" } });
  const buyer = await prisma.user.findUniqueOrThrow({ where: { lineUserId: "mock-buyer-1" } });
  const admin = await prisma.adminUser.findFirstOrThrow();
  return { orchard, durianLot, mangoLot, buyer, admin };
}

// Fresh PAID order (durian 10@180 + mango 5@90, subTotal 2250) driven through the real payment
// callback so totals + transferAmount are set the production way (mirrors the P5 suite).
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

  const cb = buildMockCallback(orderNo, 2250);
  const res = await paymentCb(
    new Request("http://test/api/interface/payment/callback", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(cb),
    }),
  );
  if (res.status !== 200) throw new Error(`payment callback failed: ${res.status}`);

  return prisma.order.findUniqueOrThrow({
    where: { id: created.id },
    include: { items: { include: { lot: true } } },
  });
}

async function cleanupOrder(orderId: string) {
  // Claims + children
  const claimIds = (await prisma.claim.findMany({ where: { orderId }, select: { id: true } })).map((c) => c.id);
  await prisma.claimImage.deleteMany({ where: { claimId: { in: claimIds } } });
  await prisma.claimEvent.deleteMany({ where: { claimId: { in: claimIds } } });
  await prisma.refund.deleteMany({ where: { orderId } });
  await prisma.claim.deleteMany({ where: { orderId } });
  // Packing + children
  const manifestIds = (await prisma.packingManifest.findMany({ where: { orderId }, select: { id: true } })).map((m) => m.id);
  await prisma.manifestImage.deleteMany({ where: { manifestId: { in: manifestIds } } });
  await prisma.packingItem.deleteMany({ where: { manifestId: { in: manifestIds } } });
  await prisma.packingManifest.deleteMany({ where: { orderId } });
  // Order
  await prisma.paymentCallbackLog.deleteMany({ where: { orderId } });
  await prisma.payment.deleteMany({ where: { orderId } });
  await prisma.orderItem.deleteMany({ where: { orderId } });
  await prisma.order.deleteMany({ where: { id: orderId } });
}

live("phase 6 packing/manifest (needs DB)", () => {
  const created: string[] = [];
  afterAll(async () => {
    for (const id of created) await cleanupOrder(id);
    await prisma.$disconnect();
  }, 60_000);

  // AC2/3/4: create manifest from OrderItems, reconcile a mismatch -> VARIANCE, signoff gate.
  it("reconcile flags a mismatch -> VARIANCE; signoff blocked from OPEN/VARIANCE-without-note; ok with note", async () => {
    const order = await seedPaidOrder();
    created.push(order.id);

    const m = await createManifest({ orderId: order.id });
    expect(isPackingError(m)).toBe(false);
    if (isPackingError(m)) return;
    expect(m.manifest.status).toBe("OPEN");
    expect(m.manifest.expectedCount).toBe(15); // 10 + 5
    expect(m.manifest.items.length).toBe(2);

    // Signoff blocked straight from OPEN.
    const fromOpen = await signOffManifest({ manifestId: m.manifest.id, signedOffBy: "admin", note: "x" });
    expect(isPackingError(fromOpen)).toBe(true);
    if (isPackingError(fromOpen)) expect(fromOpen.status).toBe(409);

    // Pack one item short -> VARIANCE.
    const durianItem = m.manifest.items.find((it) => it.expectedQty === 10)!;
    const mangoItem = m.manifest.items.find((it) => it.expectedQty === 5)!;
    const recon = await setPackedQtys({
      manifestId: m.manifest.id,
      packedBy: "admin",
      items: [
        { orderItemId: durianItem.orderItemId, packedQty: 8 }, // short by 2
        { orderItemId: mangoItem.orderItemId, packedQty: 5 },
      ],
    });
    expect(isPackingError(recon)).toBe(false);
    if (isPackingError(recon)) return;
    expect(recon.manifest.status).toBe("VARIANCE");
    expect(recon.manifest.hasVariance).toBe(true);
    expect(recon.manifest.packedCount).toBe(13);

    // VARIANCE signoff without a note -> 422.
    const noNote = await signOffManifest({ manifestId: m.manifest.id, signedOffBy: "admin" });
    expect(isPackingError(noNote)).toBe(true);
    if (isPackingError(noNote)) expect(noNote.status).toBe(422);

    // With a note -> SIGNED_OFF.
    const ok = await signOffManifest({ manifestId: m.manifest.id, signedOffBy: "admin-1", note: "short by 2 boxes" });
    expect(isPackingError(ok)).toBe(false);
    if (isPackingError(ok)) return;
    expect(ok.manifest.status).toBe("SIGNED_OFF");
    expect(ok.manifest.signedOffBy).toBe("admin-1");
    expect(ok.manifest.signedOffAt).toBeTruthy();
  });

  it("exact-match reconcile -> RECONCILED (no variance)", async () => {
    const order = await seedPaidOrder();
    created.push(order.id);
    const m = await createManifest({ orderId: order.id });
    if (isPackingError(m)) throw new Error(m.error);
    const recon = await setPackedQtys({
      manifestId: m.manifest.id,
      packedBy: "admin",
      items: m.manifest.items.map((it) => ({ orderItemId: it.orderItemId, packedQty: it.expectedQty })),
    });
    if (isPackingError(recon)) throw new Error(recon.error);
    expect(recon.manifest.status).toBe("RECONCILED");
    expect(recon.manifest.hasVariance).toBe(false);
  });
});

live("phase 6 claim intake/triage + refund linkage (needs DB)", () => {
  const created: string[] = [];
  afterAll(async () => {
    for (const id of created) await cleanupOrder(id);
    await prisma.$disconnect();
  }, 60_000);

  // AC5: buyer files a claim -> OPEN Claim persisted; evidence image stores a URL row.
  it("file claim writes a Claim (OPEN) + a FILE event + a ClaimImage URL row (no binary in DB)", async () => {
    const order = await seedPaidOrder();
    created.push(order.id);
    const { buyer } = await findSeed();

    const filed = await fileClaim({
      orderId: order.id,
      buyerId: buyer.id,
      category: "DAMAGED",
      description: "ทุเรียนช้ำ 2 ลูก",
      actor: buyer.phone ?? "buyer",
    });
    expect(isClaimError(filed)).toBe(false);
    if (isClaimError(filed)) return;
    expect(filed.claim.status).toBe("OPEN");
    expect(filed.claim.claimNo).toMatch(/^CL/);

    const events = await prisma.claimEvent.findMany({ where: { claimId: filed.claim.id } });
    expect(events.some((e) => e.action === "FILE" && e.toStatus === "OPEN")).toBe(true);

    // Evidence image via the storage adapter -> URL row only.
    const { url } = await getStorage().putImage({
      name: "evidence.jpg",
      bytes: Buffer.from("fake-jpeg-bytes"),
      contentType: "image/jpeg",
    });
    const img = await prisma.claimImage.create({ data: { claimId: filed.claim.id, url } });
    expect(img.url).toBe(url);
    expect(img.url).not.toContain("fake-jpeg-bytes"); // URL only, not the binary
  });

  // AC6/7: triage transitions + RESOLVED with createRefund creates a linked Refund atomically.
  it("triage OPEN->TRIAGING then RESOLVED + createRefund -> Refund.claimId set, CUSTOMER, PENDING", async () => {
    const order = await seedPaidOrder();
    created.push(order.id);
    const { buyer, admin } = await findSeed();

    const filed = await fileClaim({
      orderId: order.id,
      buyerId: buyer.id,
      category: "QUALITY",
      description: "คุณภาพไม่ตรงเกรด",
      actor: buyer.phone ?? "buyer",
    });
    if (isClaimError(filed)) throw new Error(filed.error);

    // Triage (human-only at route) -> TRIAGING + a TRIAGE event.
    const triaged = await triageClaim({
      claimId: filed.claim.id,
      action: "TRIAGE",
      severity: "HIGH",
      aiFlag: "ai-suggested:QUALITY",
      actor: admin.id,
    });
    if (isClaimError(triaged)) throw new Error(triaged.error);
    expect(triaged.claim.status).toBe("TRIAGING");
    expect(triaged.claim.severity).toBe("HIGH");
    expect(triaged.event.action).toBe("TRIAGE");

    // Resolve + create a partial refund -> linked Refund (1:1 via claimId).
    // actor = AdminUser.id (Refund.approvedBy FK -> AdminUser).
    const resolved = await resolveClaim({
      claimId: filed.claim.id,
      decision: "RESOLVED",
      createRefund: true,
      refundKind: "PARTIAL",
      refundAmount: 360, // 2 durians @180
      actor: admin.id,
    });
    if (isClaimError(resolved)) throw new Error(resolved.error);
    expect(resolved.claim.status).toBe("RESOLVED");
    expect(resolved.claim.resolvedBy).toBe(admin.id);
    expect(resolved.refund).toBeTruthy();
    expect(resolved.refund!.claimId).toBe(filed.claim.id);
    expect(resolved.refund!.payoutType).toBe("CUSTOMER");
    expect(resolved.refund!.status).toBe("PENDING");
    expect(Number(resolved.refund!.amount)).toBe(360);

    // The refund row is reachable from the claim back-relation (1:1).
    const reread = await prisma.claim.findUniqueOrThrow({ where: { id: filed.claim.id }, include: { refund: true } });
    expect(reread.refund?.id).toBe(resolved.refund!.id);

    // RESOLVED is terminal -> a second resolve attempt is rejected (409).
    const again = await resolveClaim({ claimId: filed.claim.id, decision: "REJECTED", actor: "admin-1" });
    expect(isClaimError(again)).toBe(true);
    if (isClaimError(again)) expect(again.status).toBe(409);
  });

  it("over-refund on resolve -> 422, no Refund/claim left half-written", async () => {
    const order = await seedPaidOrder();
    created.push(order.id);
    const { buyer, admin } = await findSeed();
    const filed = await fileClaim({ orderId: order.id, buyerId: buyer.id, category: "MISSING", description: "ขาด", actor: buyer.phone ?? "buyer" });
    if (isClaimError(filed)) throw new Error(filed.error);
    await triageClaim({ claimId: filed.claim.id, action: "TRIAGE", actor: admin.id });

    const over = await resolveClaim({
      claimId: filed.claim.id,
      decision: "RESOLVED",
      createRefund: true,
      refundKind: "PARTIAL",
      refundAmount: 999999, // > order total -> over-refund
      actor: admin.id,
    });
    expect(isClaimError(over)).toBe(true);
    if (isClaimError(over)) expect(over.status).toBe(422);

    // Atomic: the failed resolve must not have transitioned the claim or created a refund.
    const claim = await prisma.claim.findUniqueOrThrow({ where: { id: filed.claim.id } });
    expect(claim.status).toBe("TRIAGING");
    const refunds = await prisma.refund.count({ where: { claimId: filed.claim.id } });
    expect(refunds).toBe(0);
  });
});
