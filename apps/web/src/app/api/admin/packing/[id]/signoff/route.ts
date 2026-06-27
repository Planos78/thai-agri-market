import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requirePerm } from "@/lib/rbac";
import { requireOrderScope } from "@/lib/fulfillment-scope";
import { signOffManifest, isPackingError } from "@/lib/packing-tx";

// P6: human sign-off. Blocked from OPEN (409); VARIANCE requires a note (422). packing.write.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const claims = await requirePerm(req, "packing.write");
  if (claims instanceof NextResponse) return claims;
  const { id } = await params;

  const manifest = await prisma.packingManifest.findUnique({ where: { id }, select: { orderId: true } });
  if (!manifest) return NextResponse.json({ error: "manifest not found" }, { status: 404 });
  const scopeErr = await requireOrderScope(claims, manifest.orderId);
  if (scopeErr) return scopeErr;

  const { note } = (await req.json().catch(() => ({}))) as { note?: string };
  const result = await signOffManifest({ manifestId: id, signedOffBy: claims.sub, note: note ?? null });
  if (isPackingError(result)) return NextResponse.json({ error: result.error }, { status: result.status });
  return NextResponse.json(result);
}
