import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requirePerm } from "@/lib/rbac";
import { requireOrderScope } from "@/lib/fulfillment-scope";

// #11 Create/update delivery; Order PAID->PREPARING (ops starts fulfillment).
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const claims = await requirePerm(req, "delivery.write");
  if (claims instanceof NextResponse) return claims;
  const { id } = await params;
  const scopeErr = await requireOrderScope(claims, id);
  if (scopeErr) return scopeErr;

  const order = await prisma.order.findUnique({ where: { id } });
  if (!order) return NextResponse.json({ error: "order not found" }, { status: 404 });

  const { trackingNo, carrier } = (await req.json().catch(() => ({}))) as {
    trackingNo?: string;
    carrier?: string;
  };

  const delivery = await prisma.$transaction(async (tx) => {
    const d = await tx.delivery.upsert({
      where: { orderId: id },
      create: { orderId: id, trackingNo: trackingNo ?? null, carrier: carrier ?? null },
      update: { trackingNo: trackingNo ?? null, carrier: carrier ?? null },
    });
    if (order.status === "PAID") {
      await tx.order.update({ where: { id }, data: { status: "PREPARING" } });
    }
    return d;
  });

  return NextResponse.json({ delivery });
}
