import { NextResponse } from "next/server";
import { verifyHmac } from "@/lib/hmac";
import { payoutCallbackString } from "@/lib/psp";
import { applyPayoutCallback } from "@/lib/settlement-tx";

// #7 PSP payout callback. HMAC verified BEFORE any DB access (Gate 0 / AC7). SUCCEEDED ->
// each order escrow HELD->RELEASED + batch SUCCEEDED; else FAILED + error log. All atomic.
export async function POST(req: Request) {
  const body = await req.json();
  const { batchNo, respCode, pspBatchRef, signature } = body ?? {};

  const ok = verifyHmac(payoutCallbackString({ batchNo, respCode }), signature ?? "");
  if (!ok) {
    return NextResponse.json({ error: "bad signature" }, { status: 401 });
  }

  await applyPayoutCallback({
    batchNo,
    respCode: String(respCode),
    pspBatchRef: pspBatchRef ?? undefined,
    signature: signature ?? undefined,
    rawPayload: JSON.stringify(body),
  });
  return NextResponse.json({ ok: true });
}
