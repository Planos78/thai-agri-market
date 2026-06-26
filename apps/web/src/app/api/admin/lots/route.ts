import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requirePerm, scopedOrchardIds, inScope } from "@/lib/rbac";

export async function GET(req: Request) {
  const claims = await requirePerm(req, "lots.read");
  if (claims instanceof NextResponse) return claims;
  const scope = await scopedOrchardIds(claims);
  const lots = await prisma.lot.findMany({
    where: scope === "ALL" ? {} : { orchardId: { in: scope } },
    include: { orchard: { select: { name: true, province: true } } },
    orderBy: { createdAt: "desc" },
  });
  return NextResponse.json({ lots });
}

export async function POST(req: Request) {
  const claims = await requirePerm(req, "lots.write");
  if (claims instanceof NextResponse) return claims;
  const body = (await req.json()) as {
    orchardId?: string;
    fruitName?: string;
    price?: number;
    quantity?: number;
    variety?: string;
    grade?: string;
    unit?: string;
    minOrderQty?: number;
    harvestDate?: string;
    saleWindowStart?: string;
    saleWindowEnd?: string;
  };
  if (!body.orchardId || !body.fruitName || body.price == null || body.quantity == null) {
    return NextResponse.json({ error: "orchardId, fruitName, price, quantity required" }, { status: 400 });
  }

  const orchard = await prisma.orchard.findUnique({ where: { id: body.orchardId } });
  if (!orchard) return NextResponse.json({ error: "orchard not found" }, { status: 400 });

  const scope = await scopedOrchardIds(claims);
  if (!inScope(scope, body.orchardId)) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const lot = await prisma.$transaction((tx) =>
    tx.lot.create({
      data: {
        orchardId: body.orchardId!,
        fruitName: body.fruitName!,
        price: body.price!,
        quantity: body.quantity!,
        ...(body.variety !== undefined ? { variety: body.variety } : {}),
        ...(body.grade !== undefined ? { grade: body.grade } : {}),
        ...(body.unit !== undefined ? { unit: body.unit } : {}),
        ...(body.minOrderQty !== undefined ? { minOrderQty: body.minOrderQty } : {}),
        ...(body.harvestDate ? { harvestDate: new Date(body.harvestDate) } : {}),
        ...(body.saleWindowStart ? { saleWindowStart: new Date(body.saleWindowStart) } : {}),
        ...(body.saleWindowEnd ? { saleWindowEnd: new Date(body.saleWindowEnd) } : {}),
      },
    }),
  );
  return NextResponse.json({ lot }, { status: 201 });
}
