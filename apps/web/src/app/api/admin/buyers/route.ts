import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requirePerm } from "@/lib/rbac";

// Verified LINE buyers + their latest consent record (PDPA trail).
export async function GET(req: Request) {
  const claims = await requirePerm(req, "buyers.read");
  if (claims instanceof NextResponse) return claims;

  const users = await prisma.verifiedLineUser.findMany({ orderBy: { verifiedAt: "desc" } });
  const buyers = await Promise.all(
    users.map(async (u) => {
      const latestConsent = await prisma.consentLog.findFirst({
        where: { lineUserId: u.lineUserId },
        orderBy: { createdAt: "desc" },
      });
      return { ...u, latestConsent };
    }),
  );
  return NextResponse.json({ buyers });
}
