import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getLine } from "@/lib/line";

// Verify a LINE ID token server-side (clean break, no MD5/AES) and report whether
// the user has passed phone verification. Audits the request (LiffRequestLog).
export async function POST(req: Request) {
  const { idToken } = await req.json();
  const profile = await getLine().verifyIdToken(idToken ?? "");
  if (!profile) {
    await prisma.liffRequestLog.create({
      data: { lineUserId: null, path: "/api/liff/verify-line", method: "POST", status: 401 },
    });
    return NextResponse.json({ error: "invalid token" }, { status: 401 });
  }

  const verified = await prisma.verifiedLineUser.findUnique({
    where: { lineUserId: profile.lineUserId },
  });
  await prisma.liffRequestLog.create({
    data: { lineUserId: profile.lineUserId, path: "/api/liff/verify-line", method: "POST", status: 200 },
  });
  return NextResponse.json({
    lineUserId: profile.lineUserId,
    name: profile.name ?? verified?.name ?? null,
    verified: !!verified,
  });
}
