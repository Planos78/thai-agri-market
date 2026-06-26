import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requirePerm, scopedOrchardIds, inScope } from "@/lib/rbac";

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const claims = await requirePerm(req, "orchards.write");
  if (claims instanceof NextResponse) return claims;
  const { id } = await params;

  const scope = await scopedOrchardIds(claims);
  if (!inScope(scope, id)) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const existing = await prisma.orchard.findUnique({ where: { id } });
  if (!existing) return NextResponse.json({ error: "not found" }, { status: 404 });

  const { name, province, description, isVerified } = (await req.json()) as {
    name?: string;
    province?: string;
    description?: string;
    isVerified?: boolean;
  };

  const orchard = await prisma.$transaction((tx) =>
    tx.orchard.update({
      where: { id },
      data: {
        ...(name !== undefined ? { name } : {}),
        ...(province !== undefined ? { province } : {}),
        ...(description !== undefined ? { description } : {}),
        ...(isVerified !== undefined ? { isVerified } : {}),
      },
    }),
  );
  return NextResponse.json({ orchard });
}
