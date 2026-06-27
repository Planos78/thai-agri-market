import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requirePerm } from "@/lib/rbac";
import { requireOrderScope } from "@/lib/fulfillment-scope";
import { setPackedQtys, isPackingError } from "@/lib/packing-tx";

// P6: set packedQty per item; recomputes counts + variance + status. packing.write; order-scoped.
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const claims = await requirePerm(req, "packing.write");
  if (claims instanceof NextResponse) return claims;
  const { id } = await params;

  const manifest = await prisma.packingManifest.findUnique({ where: { id }, select: { orderId: true } });
  if (!manifest) return NextResponse.json({ error: "manifest not found" }, { status: 404 });
  const scopeErr = await requireOrderScope(claims, manifest.orderId);
  if (scopeErr) return scopeErr;

  const { items } = (await req.json()) as { items?: { orderItemId: string; packedQty: number }[] };
  if (!Array.isArray(items) || items.length === 0) {
    return NextResponse.json({ error: "items required" }, { status: 422 });
  }

  const result = await setPackedQtys({ manifestId: id, items, packedBy: claims.sub });
  if (isPackingError(result)) return NextResponse.json({ error: result.error }, { status: result.status });
  return NextResponse.json(result);
}
