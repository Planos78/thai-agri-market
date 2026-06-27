import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requirePerm } from "@/lib/rbac";

// #1 List payout accounts (optionally by orchard). Human-only (payout.read).
export async function GET(req: Request) {
  const claims = await requirePerm(req, "payout.read");
  if (claims instanceof NextResponse) return claims;
  const orchardId = new URL(req.url).searchParams.get("orchardId") ?? undefined;
  const accounts = await prisma.payoutAccount.findMany({
    where: orchardId ? { orchardId } : undefined,
    include: { bank: true, orchard: { select: { name: true } } },
    orderBy: { createdAt: "desc" },
  });
  return NextResponse.json({ accounts });
}

// #2 Create a payout account. If isDefault, unset prior default for the orchard (one tx).
export async function POST(req: Request) {
  const claims = await requirePerm(req, "payout.write");
  if (claims instanceof NextResponse) return claims;

  const { orchardId, bankId, accNo, accName, payoutKey, isDefault } = (await req.json()) as {
    orchardId?: string;
    bankId?: string;
    accNo?: string;
    accName?: string;
    payoutKey?: string;
    isDefault?: boolean;
  };
  if (!orchardId || !bankId || !accNo || !accName) {
    return NextResponse.json({ error: "orchardId, bankId, accNo, accName required" }, { status: 422 });
  }

  const account = await prisma.$transaction(async (tx) => {
    if (isDefault) {
      await tx.payoutAccount.updateMany({ where: { orchardId, isDefault: true }, data: { isDefault: false } });
    }
    return tx.payoutAccount.create({
      data: { orchardId, bankId, accNo, accName, payoutKey: payoutKey ?? null, isDefault: !!isDefault },
    });
  });
  return NextResponse.json({ account }, { status: 201 });
}
