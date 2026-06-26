import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

// Browse active lots (no plant search / no price chain — roadmap §5 rule 1 dropped).
export async function GET() {
  const lots = await prisma.lot.findMany({
    where: { status: "ACTIVE", qcStatus: "RELEASED" },
    include: { orchard: { select: { name: true, province: true } } },
    orderBy: { createdAt: "desc" },
  });
  return NextResponse.json({ lots });
}
