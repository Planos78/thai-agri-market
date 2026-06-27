import { prisma } from "@/lib/db";
import { reconcile, canSignOff } from "@/lib/packing";

// State mutations for P6 packing/manifest. Every change is wrapped in prisma.$transaction.
// Create/reconcile/sign-off are HUMAN-only (gated at route by packing.write perm); no auto path.

interface PackingError {
  error: string;
  status: number;
}
function err(error: string, status: number): PackingError {
  return { error, status };
}
function isErr(x: unknown): x is PackingError {
  return typeof x === "object" && x !== null && "error" in x && "status" in x;
}
export { isErr as isPackingError };

// Create a manifest for an order, seeding PackingItem rows from each OrderItem (expectedQty =
// OrderItem.quantity, packedQty = 0). One manifest per order (orderId @unique -> 409 on dup).
export async function createManifest(opts: { orderId: string }) {
  const order = await prisma.order.findUnique({
    where: { id: opts.orderId },
    include: { items: true },
  });
  if (!order) return err("order not found", 404);
  if (order.items.length === 0) return err("order has no items", 422);

  const existing = await prisma.packingManifest.findUnique({ where: { orderId: opts.orderId } });
  if (existing) return err("manifest already exists for this order", 409);

  return prisma.$transaction(async (tx) => {
    const expectedCount = order.items.reduce((s, it) => s + it.quantity, 0);
    const manifest = await tx.packingManifest.create({
      data: {
        orderId: order.id,
        status: "OPEN",
        expectedCount,
        packedCount: 0,
        hasVariance: false,
        items: {
          create: order.items.map((it) => ({
            orderItemId: it.id,
            expectedQty: it.quantity,
            packedQty: 0,
          })),
        },
      },
      include: { items: true },
    });
    return { manifest };
  });
}

// Set packedQty for one or more items, then recompute counts + variance + status.
// Only allowed before sign-off (SIGNED_OFF is terminal). Human-only (packing.write).
export async function setPackedQtys(opts: {
  manifestId: string;
  items: { orderItemId: string; packedQty: number }[];
  packedBy: string;
}) {
  if (!Array.isArray(opts.items) || opts.items.length === 0) {
    return err("items required", 422);
  }
  for (const i of opts.items) {
    if (!Number.isInteger(i.packedQty) || i.packedQty < 0) {
      return err("packedQty must be a non-negative integer", 422);
    }
  }

  return prisma.$transaction(async (tx) => {
    const manifest = await tx.packingManifest.findUnique({
      where: { id: opts.manifestId },
      include: { items: true },
    });
    if (!manifest) return err("manifest not found", 404);
    if (manifest.status === "SIGNED_OFF") return err("manifest already signed off", 409);

    const byOrderItem = new Map(manifest.items.map((it) => [it.orderItemId, it]));
    for (const upd of opts.items) {
      const row = byOrderItem.get(upd.orderItemId);
      if (!row) return err(`orderItemId ${upd.orderItemId} not in manifest`, 422);
      await tx.packingItem.update({ where: { id: row.id }, data: { packedQty: upd.packedQty } });
      row.packedQty = upd.packedQty; // reflect for recompute below
    }

    const r = reconcile(manifest.items.map((it) => ({ expectedQty: it.expectedQty, packedQty: it.packedQty })));
    const updated = await tx.packingManifest.update({
      where: { id: manifest.id },
      data: {
        expectedCount: r.expectedCount,
        packedCount: r.packedCount,
        hasVariance: r.hasVariance,
        status: r.status,
        packedBy: opts.packedBy,
        packedAt: new Date(),
      },
      include: { items: true },
    });
    return { manifest: updated };
  });
}

// Human sign-off. Blocked from OPEN (409); VARIANCE requires a non-empty note (422).
// Sets SIGNED_OFF + signedOffBy/At. Human-only (packing.write).
export async function signOffManifest(opts: { manifestId: string; signedOffBy: string; note?: string | null }) {
  return prisma.$transaction(async (tx) => {
    const manifest = await tx.packingManifest.findUnique({ where: { id: opts.manifestId } });
    if (!manifest) return err("manifest not found", 404);

    const blocked = canSignOff(manifest.status, opts.note);
    if (blocked) return err(blocked.error, blocked.status);

    const updated = await tx.packingManifest.update({
      where: { id: manifest.id },
      data: {
        status: "SIGNED_OFF",
        signedOffBy: opts.signedOffBy,
        signedOffAt: new Date(),
        ...(opts.note != null ? { note: opts.note } : {}),
      },
      include: { items: true },
    });
    return { manifest: updated };
  });
}
