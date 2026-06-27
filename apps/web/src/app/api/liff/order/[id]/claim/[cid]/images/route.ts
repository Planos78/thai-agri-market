import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { resolveBuyerOrder } from "@/lib/fulfillment-scope";
import { getStorage } from "@/lib/storage";

const MAX_BYTES = 8 * 1024 * 1024; // 8MB per file

// P6: a verified LINE buyer uploads claim evidence image(s) for their own order's claim.
// Stores URL/path only via storage adapter (bug #7).
export async function POST(req: Request, { params }: { params: Promise<{ id: string; cid: string }> }) {
  const { id, cid } = await params;
  const lineUserId = new URL(req.url).searchParams.get("lineUserId") ?? undefined;

  const owner = await resolveBuyerOrder(id, lineUserId);
  if (owner instanceof NextResponse) return owner;

  const claim = await prisma.claim.findUnique({ where: { id: cid }, select: { id: true, orderId: true } });
  if (!claim || claim.orderId !== id) return NextResponse.json({ error: "claim not found" }, { status: 404 });

  const form = await req.formData().catch(() => null);
  if (!form) return NextResponse.json({ error: "multipart/form-data required" }, { status: 400 });
  const files = form.getAll("file").filter((f): f is File => f instanceof File);
  if (files.length === 0) return NextResponse.json({ error: "at least one file required" }, { status: 400 });

  const storage = getStorage();
  const images = [];
  for (const file of files) {
    if (file.size > MAX_BYTES) return NextResponse.json({ error: "file too large" }, { status: 413 });
    if (!file.type.startsWith("image/")) return NextResponse.json({ error: "image files only" }, { status: 400 });
    const bytes = new Uint8Array(await file.arrayBuffer());
    const { url } = await storage.putImage({ name: file.name, bytes, contentType: file.type });
    images.push(await prisma.claimImage.create({ data: { claimId: claim.id, url } }));
  }
  return NextResponse.json({ images }, { status: 201 });
}
