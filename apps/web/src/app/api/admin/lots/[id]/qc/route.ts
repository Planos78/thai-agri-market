import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requirePerm, scopedOrchardIds, inScope } from "@/lib/rbac";

const MAP = { RELEASE: "RELEASED", HOLD: "HOLD", DOWNGRADE: "DOWNGRADED" } as const;

// Human-only QC sign-off. No auto path. Lot.qcStatus update + QcAudit in one tx.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const claims = await requirePerm(req, "qc.release");
  if (claims instanceof NextResponse) return claims;
  const { id } = await params;

  const lot = await prisma.lot.findUnique({ where: { id } });
  if (!lot) return NextResponse.json({ error: "not found" }, { status: 404 });

  const scope = await scopedOrchardIds(claims);
  if (!inScope(scope, lot.orchardId)) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const { action, note } = (await req.json()) as { action?: keyof typeof MAP; note?: string };
  const toStatus = action ? MAP[action] : undefined;
  if (!toStatus) return NextResponse.json({ error: "invalid action" }, { status: 400 });

  const result = await prisma.$transaction(async (tx) => {
    const updated = await tx.lot.update({ where: { id }, data: { qcStatus: toStatus } });
    const audit = await tx.qcAudit.create({
      data: {
        lotId: id,
        fromStatus: lot.qcStatus,
        toStatus,
        action: action!,
        note: note ?? null,
        adminUserId: claims.sub,
      },
    });
    return { lot: updated, audit };
  });

  return NextResponse.json(result);
}
