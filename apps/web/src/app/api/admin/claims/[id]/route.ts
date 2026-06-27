import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requirePerm } from "@/lib/rbac";

// P6: read a claim + its images + audit events. claims.read.
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const claims = await requirePerm(req, "claims.read");
  if (claims instanceof NextResponse) return claims;
  const { id } = await params;

  const claim = await prisma.claim.findUnique({
    where: { id },
    include: {
      images: true,
      events: { orderBy: { createdAt: "asc" } },
      refund: { select: { id: true, refundNo: true, amount: true, status: true } },
    },
  });
  if (!claim) return NextResponse.json({ error: "claim not found" }, { status: 404 });

  return NextResponse.json({ claim, images: claim.images, events: claim.events });
}
