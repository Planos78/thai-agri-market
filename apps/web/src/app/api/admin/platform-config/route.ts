import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requirePerm } from "@/lib/rbac";

// #12 GET active platform config (take-rate / VAT). Human-only (config.write gates both).
export async function GET(req: Request) {
  const claims = await requirePerm(req, "config.write");
  if (claims instanceof NextResponse) return claims;
  const config = await prisma.platformConfig.findFirst({
    where: { isActive: true },
    orderBy: { createdAt: "desc" },
  });
  return NextResponse.json({ config });
}

// #12 Set a new active platform config; deactivates the prior active row (one tx, auditable).
export async function POST(req: Request) {
  const claims = await requirePerm(req, "config.write");
  if (claims instanceof NextResponse) return claims;

  const { takeRate, vatRate, note } = (await req.json()) as {
    takeRate?: number;
    vatRate?: number;
    note?: string;
  };
  if (takeRate == null || vatRate == null || !(takeRate >= 0) || !(vatRate >= 0)) {
    return NextResponse.json({ error: "takeRate and vatRate (>=0) required" }, { status: 422 });
  }

  const config = await prisma.$transaction(async (tx) => {
    await tx.platformConfig.updateMany({ where: { isActive: true }, data: { isActive: false } });
    return tx.platformConfig.create({
      data: { takeRate: String(takeRate), vatRate: String(vatRate), note: note ?? null, isActive: true },
    });
  });
  return NextResponse.json({ config }, { status: 201 });
}
