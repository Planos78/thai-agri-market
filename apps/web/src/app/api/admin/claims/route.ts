import { NextResponse } from "next/server";
import type { ClaimStatus, Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { requirePerm } from "@/lib/rbac";

const STATUSES: ClaimStatus[] = ["OPEN", "TRIAGING", "RESOLVED", "REJECTED", "ESCALATED"];

// P6: list claims for triage. claims.read. Optional ?status & ?orderId filters.
export async function GET(req: Request) {
  const claims = await requirePerm(req, "claims.read");
  if (claims instanceof NextResponse) return claims;

  const url = new URL(req.url);
  const status = url.searchParams.get("status");
  const orderId = url.searchParams.get("orderId");

  const where: Prisma.ClaimWhereInput = {};
  if (status && STATUSES.includes(status as ClaimStatus)) where.status = status as ClaimStatus;
  if (orderId) where.orderId = orderId;

  const rows = await prisma.claim.findMany({
    where,
    orderBy: { createdAt: "desc" },
    include: { _count: { select: { images: true, events: true } } },
  });
  return NextResponse.json({ claims: rows });
}
