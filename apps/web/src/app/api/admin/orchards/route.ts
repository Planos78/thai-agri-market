import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requirePerm, scopedOrchardIds } from "@/lib/rbac";

export async function GET(req: Request) {
  const claims = await requirePerm(req, "orchards.read");
  if (claims instanceof NextResponse) return claims;
  const scope = await scopedOrchardIds(claims);
  const orchards = await prisma.orchard.findMany({
    where: scope === "ALL" ? {} : { id: { in: scope } },
    orderBy: { createdAt: "desc" },
    // bug #4: surface LINE binding count so the UI can warn when an orchard is unbound.
    include: { _count: { select: { lineBindings: true } } },
  });
  return NextResponse.json({
    orchards: orchards.map((o) => ({ ...o, lineBindingCount: o._count.lineBindings })),
  });
}

export async function POST(req: Request) {
  const claims = await requirePerm(req, "orchards.write");
  if (claims instanceof NextResponse) return claims;
  const { name, province, ownerId, description } = (await req.json()) as {
    name?: string;
    province?: string;
    ownerId?: string;
    description?: string;
  };
  if (!name || !province || !ownerId) {
    return NextResponse.json({ error: "name, province, ownerId required" }, { status: 400 });
  }
  const orchard = await prisma.$transaction((tx) =>
    tx.orchard.create({ data: { name, province, ownerId, description: description ?? null } }),
  );
  return NextResponse.json({ orchard }, { status: 201 });
}
