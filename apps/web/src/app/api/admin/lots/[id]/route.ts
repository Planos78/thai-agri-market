import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requirePerm, scopedOrchardIds, inScope } from "@/lib/rbac";

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const claims = await requirePerm(req, "lots.write");
  if (claims instanceof NextResponse) return claims;
  const { id } = await params;

  const lot = await prisma.lot.findUnique({ where: { id } });
  if (!lot) return NextResponse.json({ error: "not found" }, { status: 404 });

  const scope = await scopedOrchardIds(claims);
  if (!inScope(scope, lot.orchardId)) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const body = (await req.json()) as {
    fruitName?: string;
    variety?: string;
    grade?: string;
    price?: number;
    quantity?: number;
    unit?: string;
    minOrderQty?: number;
    harvestDate?: string;
    saleWindowStart?: string;
    saleWindowEnd?: string;
    status?: string;
  };

  const updated = await prisma.$transaction((tx) =>
    tx.lot.update({
      where: { id },
      data: {
        ...(body.fruitName !== undefined ? { fruitName: body.fruitName } : {}),
        ...(body.variety !== undefined ? { variety: body.variety } : {}),
        ...(body.grade !== undefined ? { grade: body.grade } : {}),
        ...(body.price !== undefined ? { price: body.price } : {}),
        ...(body.quantity !== undefined ? { quantity: body.quantity } : {}),
        ...(body.unit !== undefined ? { unit: body.unit } : {}),
        ...(body.minOrderQty !== undefined ? { minOrderQty: body.minOrderQty } : {}),
        ...(body.harvestDate ? { harvestDate: new Date(body.harvestDate) } : {}),
        ...(body.saleWindowStart ? { saleWindowStart: new Date(body.saleWindowStart) } : {}),
        ...(body.saleWindowEnd ? { saleWindowEnd: new Date(body.saleWindowEnd) } : {}),
        ...(body.status !== undefined ? { status: body.status as never } : {}),
      },
    }),
  );
  return NextResponse.json({ lot: updated });
}
