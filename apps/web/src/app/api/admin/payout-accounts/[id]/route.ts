import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requirePerm } from "@/lib/rbac";

// #3 Update a payout account (accNo/accName/isActive/isDefault). Human-only (payout.write).
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const claims = await requirePerm(req, "payout.write");
  if (claims instanceof NextResponse) return claims;
  const { id } = await params;

  const existing = await prisma.payoutAccount.findUnique({ where: { id } });
  if (!existing) return NextResponse.json({ error: "payout account not found" }, { status: 404 });

  const { accNo, accName, payoutKey, isActive, isDefault } = (await req.json().catch(() => ({}))) as {
    accNo?: string;
    accName?: string;
    payoutKey?: string;
    isActive?: boolean;
    isDefault?: boolean;
  };

  const account = await prisma.$transaction(async (tx) => {
    if (isDefault === true) {
      await tx.payoutAccount.updateMany({
        where: { orchardId: existing.orchardId, isDefault: true },
        data: { isDefault: false },
      });
    }
    return tx.payoutAccount.update({
      where: { id },
      data: {
        ...(accNo !== undefined ? { accNo } : {}),
        ...(accName !== undefined ? { accName } : {}),
        ...(payoutKey !== undefined ? { payoutKey } : {}),
        ...(isActive !== undefined ? { isActive } : {}),
        ...(isDefault !== undefined ? { isDefault } : {}),
      },
    });
  });
  return NextResponse.json({ account });
}

// #3 Soft-delete (deactivate) a payout account. Human-only (payout.write).
export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const claims = await requirePerm(req, "payout.write");
  if (claims instanceof NextResponse) return claims;
  const { id } = await params;

  const existing = await prisma.payoutAccount.findUnique({ where: { id } });
  if (!existing) return NextResponse.json({ error: "payout account not found" }, { status: 404 });

  const account = await prisma.payoutAccount.update({
    where: { id },
    data: { isActive: false, isDefault: false },
  });
  return NextResponse.json({ account });
}
