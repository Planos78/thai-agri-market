import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { verifyHmac } from "@/lib/hmac";
import { callbackPayloadString, PSP_SUCCESS } from "@/lib/psp";
import { isIncreasePayInvoice } from "@/lib/fulfillment";
import { relayPush } from "@/lib/line";
import { calcTransferAmount } from "@/lib/money";

// PSP payment callback. The only surface verified by signature, not JWT.
// HMAC is checked BEFORE any DB access (AC4); the state flip is atomic (AC5).
// invoiceNo prefix disambiguates: "IP-..." = increase-payment, otherwise an order ("S...").
export async function POST(req: Request) {
  const body = await req.json();
  const { invoiceNo, amount, respCode, respDesc, tranRef, signature } = body ?? {};

  const ok = verifyHmac(callbackPayloadString({ invoiceNo, amount, respCode }), signature ?? "");
  if (!ok) {
    return NextResponse.json({ error: "bad signature" }, { status: 401 });
  }

  if (isIncreasePayInvoice(invoiceNo)) {
    return handleIncreasePay({ body, invoiceNo, amount, respCode, respDesc, tranRef, signature });
  }
  return handleOrder({ body, invoiceNo, amount, respCode, respDesc, tranRef, signature });
}

type Cb = {
  body: unknown;
  invoiceNo: string;
  amount: number;
  respCode: unknown;
  respDesc?: string;
  tranRef?: string;
  signature?: string;
};

async function handleOrder({ body, invoiceNo, amount, respCode, respDesc, tranRef, signature }: Cb) {
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
      // BUG-A fix: persist transferAmount when the order becomes PAID so the happy-path payout
      // is eligible. Same calc fn as adjustments (consistent OBS-1 clamp). At paid time the
      // refund deducted is the already-settled refundedAmount (normally 0).
      const transferAmount = calcTransferAmount(
        Number(order.totalAmount),
        Number(order.feeAmount),
        Number(order.vatFeeAmount),
        Number(order.refundedAmount),
      );
      await tx.order.update({
        where: { id: order.id },
        data: { status: "PAID", paidAt: new Date(), transferAmount },
      });
      await tx.payment.update({
        where: { orderId: order.id },
        data: { status: "COMPLETED", escrowStatus: "HELD", channel: "psp", callbackRef: tranRef ?? null },
      });
    } else {
      await tx.payment.update({ where: { orderId: order.id }, data: { status: "FAILED" } });
    }
    return { order: { lineUserId: order.buyer.lineUserId } };
  });

  if (result.order && String(respCode) === PSP_SUCCESS && result.order.lineUserId) {
    await relayPush("payment-paid", result.order.lineUserId, `ออเดอร์ ${invoiceNo} ชำระเงินสำเร็จ`);
  }
  return NextResponse.json({ ok: true });
}

async function handleIncreasePay({ body, invoiceNo, amount, respCode, respDesc, tranRef, signature }: Cb) {
  const result = await prisma.$transaction(async (tx) => {
    const ip = await tx.increasePayment.findFirst({
      where: { pspRef: invoiceNo },
      include: { order: { select: { id: true, buyer: { select: { lineUserId: true } } } } },
    });
    await tx.paymentCallbackLog.create({
      data: {
        orderId: ip?.order.id ?? null,
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
    if (!ip) return { lineUserId: null as string | null };

    if (String(respCode) === PSP_SUCCESS && ip.status === "PENDING") {
      await tx.increasePayment.update({
        where: { id: ip.id },
        data: { status: "SUCCEEDED", paidAt: new Date() },
      });
    }
    return { lineUserId: ip.order.buyer.lineUserId };
  });

  if (result.lineUserId && String(respCode) === PSP_SUCCESS) {
    await relayPush("increase-paid", result.lineUserId, `ชำระค่าสินค้าเพิ่ม ${invoiceNo} สำเร็จ`);
  }
  return NextResponse.json({ ok: true });
}
