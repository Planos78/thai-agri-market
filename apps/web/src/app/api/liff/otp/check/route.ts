import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

// Verify OTP and upsert the VerifiedLineUser (the order gate).
export async function POST(req: Request) {
  const { reference, otp, name } = await req.json();
  const log = await prisma.otpLog.findUnique({ where: { reference } });
  if (!log || log.consumedAt || log.deletedAt) {
    return NextResponse.json({ error: "invalid reference" }, { status: 400 });
  }
  if (new Date() > log.expiresAt) {
    return NextResponse.json({ error: "otp expired" }, { status: 400 });
  }
  if (log.otp !== String(otp)) {
    return NextResponse.json({ error: "otp mismatch" }, { status: 400 });
  }
  if (!log.lineUserId) {
    return NextResponse.json({ error: "otp not bound to a LINE user" }, { status: 400 });
  }

  await prisma.$transaction([
    prisma.otpLog.update({ where: { reference }, data: { consumedAt: new Date() } }),
    prisma.verifiedLineUser.upsert({
      where: { lineUserId: log.lineUserId },
      create: { lineUserId: log.lineUserId, phone: log.phone, name: name ?? null, consent: true },
      update: { phone: log.phone, consent: true },
    }),
  ]);
  return NextResponse.json({ verified: true, lineUserId: log.lineUserId });
}
