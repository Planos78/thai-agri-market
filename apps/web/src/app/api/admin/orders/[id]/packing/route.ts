import { NextResponse } from "next/server";
import { requirePerm } from "@/lib/rbac";
import { requireOrderScope } from "@/lib/fulfillment-scope";
import { createManifest, isPackingError } from "@/lib/packing-tx";

// P6 Flow 6: create a packing manifest for an order. Seeds PackingItem rows from OrderItems.
// Human-only (packing.write). One manifest per order (409 on dup).
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const claims = await requirePerm(req, "packing.write");
  if (claims instanceof NextResponse) return claims;
  const { id } = await params;
  const scopeErr = await requireOrderScope(claims, id);
  if (scopeErr) return scopeErr;

  const result = await createManifest({ orderId: id });
  if (isPackingError(result)) return NextResponse.json({ error: result.error }, { status: result.status });
  return NextResponse.json(result, { status: 201 });
}
