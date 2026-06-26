import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { verifyPassword, signAdminJwt } from "@/lib/auth";

export async function POST(req: Request) {
  const { email, password } = await req.json();
  const admin = await prisma.adminUser.findUnique({
    where: { email: email ?? "" },
    include: { role: { include: { permissions: { include: { permission: true } } } } },
  });
  if (!admin || !verifyPassword(password ?? "", admin.passwordHash)) {
    return NextResponse.json({ error: "invalid credentials" }, { status: 401 });
  }
  const perms = admin.role.permissions.map((rp) => rp.permission.code);
  const token = await signAdminJwt({ sub: admin.id, email: admin.email, perms });
  return NextResponse.json({ token, email: admin.email, perms });
}
