import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

// PDPA consent. Writes a ConsentLog row and, for required consent, flips
// VerifiedLineUser.consent. Caller must be a verified LINE user (403 otherwise).
export async function POST(req: Request) {
  const { lineUserId, purpose, granted } = (await req.json()) as {
    lineUserId?: string;
    purpose?: string;
    granted?: boolean;
  };

  if (!lineUserId || !purpose || typeof granted !== "boolean") {
    return NextResponse.json({ error: "lineUserId, purpose, granted required" }, { status: 400 });
  }

  const verified = await prisma.verifiedLineUser.findUnique({ where: { lineUserId } });
  if (!verified) {
    return NextResponse.json({ error: "line user not verified" }, { status: 403 });
  }

  await prisma.$transaction(async (tx) => {
    await tx.consentLog.create({ data: { lineUserId, purpose, granted } });
    if (purpose === "pdpa_required") {
      await tx.verifiedLineUser.update({ where: { lineUserId }, data: { consent: granted } });
    }
  });

  return NextResponse.json({ ok: true, granted });
}
