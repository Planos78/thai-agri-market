import { NextResponse } from "next/server";
import { verifyAdminJwt, bearer, type AdminClaims } from "@/lib/auth";
import { prisma } from "@/lib/db";

// 401 if no/invalid jwt; 403 if missing perm. Return claims on success.
export async function requirePerm(
  req: Request,
  perm: string,
): Promise<AdminClaims | NextResponse> {
  const claims = await verifyAdminJwt(bearer(req) ?? "");
  if (!claims) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!claims.perms.includes(perm))
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  return claims;
}

// "ALL" = no scope rows (do not lock out main admin). Otherwise the allowed orchardIds.
export async function scopedOrchardIds(
  claims: AdminClaims,
): Promise<string[] | "ALL"> {
  const rows = await prisma.userOrchardScope.findMany({
    where: { adminUserId: claims.sub },
    select: { orchardId: true },
  });
  return rows.length === 0 ? "ALL" : rows.map((r) => r.orchardId);
}

export function inScope(scope: string[] | "ALL", orchardId: string): boolean {
  return scope === "ALL" || scope.includes(orchardId);
}
