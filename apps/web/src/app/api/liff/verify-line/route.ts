import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getLine } from "@/lib/line";

// Verify a LINE ID token server-side (clean break, no MD5/AES) and report whether
// the user has passed phone verification.
export async function POST(req: Request) {
  const { idToken } = await req.json();
  const profile = await getLine().verifyIdToken(idToken ?? "");
  if (!profile) return NextResponse.json({ error: "invalid token" }, { status: 401 });

  const verified = await prisma.verifiedLineUser.findUnique({
    where: { lineUserId: profile.lineUserId },
  });
  return NextResponse.json({
    lineUserId: profile.lineUserId,
    name: profile.name ?? verified?.name ?? null,
    verified: !!verified,
  });
}
