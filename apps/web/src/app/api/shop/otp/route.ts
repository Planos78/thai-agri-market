import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/db";
import { getSms, genOtp } from "@/lib/sms";

const OTP_TTL_MS = 5 * 60 * 1000;

// #14 Issue an OTP for a web (guest) buyer by phone only. Reuses the P1 OtpLog + SMS infra
// (lineUserId stays null for shop OTPs — that is what separates web buyers from LINE).
export async function POST(req: Request) {
  const { phone } = await req.json();
  if (!phone) {
    return NextResponse.json({ error: "phone required" }, { status: 400 });
  }
  const reference = randomUUID();
  const otp = genOtp();
  await prisma.otpLog.create({
    data: { reference, phone, otp, expiresAt: new Date(Date.now() + OTP_TTL_MS) },
  });
  await getSms().send(phone, `Thai Agri Market OTP: ${otp}`);

  const mock = (process.env.SMS_PROVIDER ?? "mock") === "mock";
  return NextResponse.json({ reference, devOtp: mock ? otp : undefined });
}
