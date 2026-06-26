import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requirePerm } from "@/lib/rbac";
import { requireOrderScope } from "@/lib/fulfillment-scope";
import { getStorage } from "@/lib/storage";

const MAX_BYTES = 8 * 1024 * 1024; // 8MB per file

// #12 Upload delivery proof image(s). Stores URL/path only via storage adapter (bug #7).
// Creates DeliveryImage rows + sets proofUploadedBy + Delivery.IN_TRANSIT (tx).
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const claims = await requirePerm(req, "delivery.write");
  if (claims instanceof NextResponse) return claims;
  const { id } = await params;
  const scopeErr = await requireOrderScope(claims, id);
  if (scopeErr) return scopeErr;

  const delivery = await prisma.delivery.findUnique({ where: { orderId: id } });
  if (!delivery) return NextResponse.json({ error: "delivery not found (create delivery first)" }, { status: 404 });

  const form = await req.formData().catch(() => null);
  if (!form) return NextResponse.json({ error: "multipart/form-data required" }, { status: 400 });
  const files = form.getAll("file").filter((f): f is File => f instanceof File);
  if (files.length === 0) return NextResponse.json({ error: "at least one file required" }, { status: 400 });

  const storage = getStorage();
  const urls: string[] = [];
  for (const file of files) {
    if (file.size > MAX_BYTES) return NextResponse.json({ error: "file too large" }, { status: 413 });
    if (!file.type.startsWith("image/")) return NextResponse.json({ error: "image files only" }, { status: 400 });
    const bytes = new Uint8Array(await file.arrayBuffer());
    const { url } = await storage.putImage({ name: file.name, bytes, contentType: file.type });
    urls.push(url);
  }

  const images = await prisma.$transaction(async (tx) => {
    const created = [];
    for (const url of urls) {
      created.push(await tx.deliveryImage.create({ data: { deliveryId: delivery.id, url } }));
    }
    await tx.delivery.update({
      where: { id: delivery.id },
      data: { status: "IN_TRANSIT", proofUploadedBy: claims.sub },
    });
    return created;
  });

  return NextResponse.json({ images }, { status: 201 });
}
