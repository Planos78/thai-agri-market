import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requirePerm } from "@/lib/rbac";
import { requireOrderScope } from "@/lib/fulfillment-scope";

// P6: read a packing manifest + items + images. packing.read; order-scoped.
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const claims = await requirePerm(req, "packing.read");
  if (claims instanceof NextResponse) return claims;
  const { id } = await params;

  const manifest = await prisma.packingManifest.findUnique({
    where: { id },
    include: { items: true, images: true },
  });
  if (!manifest) return NextResponse.json({ error: "manifest not found" }, { status: 404 });

  const scopeErr = await requireOrderScope(claims, manifest.orderId);
  if (scopeErr) return scopeErr;

  return NextResponse.json({ manifest, items: manifest.items, images: manifest.images });
}
