import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { signShopSession, SHOP_SESSION_COOKIE } from "@/lib/auth";

// #14 Verify a web OTP -> mint a short-lived signed shop session (httpOnly cookie). No LINE.
export async function POST(req: Request) {
  const { reference, otp } = await req.json();
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

  await prisma.otpLog.update({ where: { reference }, data: { consumedAt: new Date() } });
  const token = await signShopSession({ phone: log.phone });

  // P6: also return the token in the body so native mobile (no cookie jar) can send it as a
  // Bearer header. Web continues to use the httpOnly cookie below (both accepted server-side).
  const res = NextResponse.json({ verified: true, phone: log.phone, token });
  res.cookies.set(SHOP_SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 2 * 60 * 60,
  });
  return res;
}
