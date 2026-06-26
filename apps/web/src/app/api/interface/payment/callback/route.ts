import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { verifyHmac } from "@/lib/hmac";
import { callbackPayloadString, PSP_SUCCESS } from "@/lib/psp";
import { relayPush } from "@/lib/line";

// PSP payment callback. The only surface verified by signature, not JWT.
// HMAC is checked BEFORE any DB access (AC4); the state flip is atomic (AC5).
export async function POST(req: Request) {
  const body = await req.json();
  const { invoiceNo, amount, respCode, respDesc, tranRef, signature } = body ?? {};

  const ok = verifyHmac(callbackPayloadString({ invoiceNo, amount, respCode }), signature ?? "");
  if (!ok) {
    return NextResponse.json({ error: "bad signature" }, { status: 401 });
  }

  const result = await prisma.$transaction(async (tx) => {
    const order = await tx.order.findUnique({
      where: { orderNo: invoiceNo },
      include: { buyer: { select: { lineUserId: true } } },
    });
    await tx.paymentCallbackLog.create({
      data: {
        orderId: order?.id ?? null,
        invoiceNo,
        amount,
        respCode: String(respCode),
        respDesc: respDesc ?? null,
        tranRef: tranRef ?? null,
        signature: signature ?? null,
        rawPayload: JSON.stringify(body),
        accepted: true,
      },
    });
    if (!order) return { order: null as null | { lineUserId: string | null } };

    if (String(respCode) === PSP_SUCCESS) {
      await tx.order.update({ where: { id: order.id }, data: { status: "PAID", paidAt: new Date() } });
      await tx.payment.update({
        where: { orderId: order.id },
        data: { status: "COMPLETED", escrowStatus: "HELD", channel: "psp", callbackRef: tranRef ?? null },
      });
    } else {
      await tx.payment.update({ where: { orderId: order.id }, data: { status: "FAILED" } });
    }
    return { order: { lineUserId: order.buyer.lineUserId } };
  });

  // Notify buyer via the internal push relay (AC7 — not a direct LINE call).
  if (result.order && String(respCode) === PSP_SUCCESS && result.order.lineUserId) {
    await relayPush("payment-paid", result.order.lineUserId, `ออเดอร์ ${invoiceNo} ชำระเงินสำเร็จ`);
  }
  return NextResponse.json({ ok: true });
}
