import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

// #13 Public shop catalog: ACTIVE + QC RELEASED lots (same gate as LIFF browse).
export async function GET() {
  const lots = await prisma.lot.findMany({
    where: { status: "ACTIVE", qcStatus: "RELEASED" },
    include: { orchard: { select: { name: true, province: true } } },
    orderBy: { createdAt: "desc" },
  });
  return NextResponse.json({ lots });
}
