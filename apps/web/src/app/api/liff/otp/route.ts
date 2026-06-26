import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/db";
import { getSms, genOtp } from "@/lib/sms";

const OTP_TTL_MS = 5 * 60 * 1000;

export async function POST(req: Request) {
  const { phone, lineUserId } = await req.json();
  if (!phone || !lineUserId) {
    return NextResponse.json({ error: "phone and lineUserId required" }, { status: 400 });
  }
  const reference = randomUUID();
  const otp = genOtp();
  await prisma.otpLog.create({
    data: { reference, phone, otp, lineUserId, expiresAt: new Date(Date.now() + OTP_TTL_MS) },
  });
  await getSms().send(phone, `Thai Agri Market OTP: ${otp}`);

  const mock = (process.env.SMS_PROVIDER ?? "mock") === "mock";
  return NextResponse.json({ reference, devOtp: mock ? otp : undefined });
}
