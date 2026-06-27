import { NextResponse } from "next/server";
import { verifyHmac } from "@/lib/hmac";
import { refundCallbackString } from "@/lib/psp";
import { applyRefundCallback } from "@/lib/settlement-tx";

// #11 PSP refund callback. HMAC verified BEFORE any DB access (Gate 0 / AC7). SUCCEEDED ->
// order.refundedAmount += amount; full refund -> escrow + payment REFUNDED. Atomic; pspRef key.
export async function POST(req: Request) {
  const body = await req.json();
  const { pspRef, amount, respCode, signature } = body ?? {};

  const ok = verifyHmac(refundCallbackString({ pspRef, amount, respCode }), signature ?? "");
  if (!ok) {
    return NextResponse.json({ error: "bad signature" }, { status: 401 });
  }

  await applyRefundCallback({ pspRef, respCode: String(respCode) });
  return NextResponse.json({ ok: true });
}
