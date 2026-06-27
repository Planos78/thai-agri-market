import { signHmac } from "@/lib/hmac";

// Swappable PSP adapter (decision #2 deferred — mock now, real Omise/2C2P/PromptPay later).
export interface PspInitResult {
  paymentUrl: string;
  invoiceNo: string;
  providerRef: string;
}

export interface PspCallback {
  invoiceNo: string;
  amount: number;
  respCode: string; // "2000" = success
  respDesc?: string;
  tranRef?: string;
  signature: string;
}

// P5: payout batch input/result + refund input/result (mock; Gate 0 — no real funds).
export interface PspPayoutBatch {
  batchNo: string;
  totalAmount: number;
  orders: { orderNo: string; amount: number }[];
}
export interface PspPayoutResult {
  pspBatchRef: string;
}
export interface PspRefundReq {
  refundNo: string;
  amount: number;
}
export interface PspRefundResult {
  pspRef: string; // "RF-..." invoice for callback correlation
}

export interface PspAdapter {
  initPayment(input: { orderNo: string; amount: number }): Promise<PspInitResult>;
  // P5 settlement — mock moves NO real funds; real adapters wired only post-Gate-0.
  payout(batch: PspPayoutBatch): Promise<PspPayoutResult>;
  refund(req: PspRefundReq): Promise<PspRefundResult>;
}

export const PSP_SUCCESS = "2000";

// Canonical string the PSP signs / we verify. Keep stable across mock + real.
export function callbackPayloadString(c: { invoiceNo: string; amount: number; respCode: string }): string {
  return `${c.invoiceNo}|${c.amount}|${c.respCode}`;
}

// P5 canonical signed strings (stable across mock + real). Correlation key first.
export function payoutCallbackString(c: { batchNo: string; respCode: string }): string {
  return `${c.batchNo}|${c.respCode}`;
}
export function refundCallbackString(c: { pspRef: string; amount: number; respCode: string }): string {
  return `${c.pspRef}|${c.amount}|${c.respCode}`;
}

export interface PspPayoutCallback {
  batchNo: string;
  respCode: string;
  signature: string;
}
export interface PspRefundCallback {
  pspRef: string;
  amount: number;
  respCode: string;
  signature: string;
}

class MockPsp implements PspAdapter {
  async initPayment({ orderNo, amount }: { orderNo: string; amount: number }): Promise<PspInitResult> {
    return {
      paymentUrl: `/mock-psp/pay?invoice=${encodeURIComponent(orderNo)}&amount=${amount}`,
      invoiceNo: orderNo,
      providerRef: `MOCK-${orderNo}`,
    };
  }
  // Mock payout: returns a deterministic batch ref; NO real transfer (Gate 0).
  async payout(batch: PspPayoutBatch): Promise<PspPayoutResult> {
    return { pspBatchRef: `MOCK-PB-${batch.batchNo}` };
  }
  // Mock refund: pspRef = "RF-<refundNo>" so the callback can correlate; NO real refund.
  async refund(req: PspRefundReq): Promise<PspRefundResult> {
    return { pspRef: `RF-${req.refundNo}` };
  }
}

export function getPsp(): PspAdapter {
  const provider = process.env.PSP_PROVIDER ?? "mock";
  switch (provider) {
    case "mock":
      return new MockPsp();
    default:
      // Gate 0: a real provider selected without creds must throw loud, never no-op.
      throw new Error(
        `PSP_PROVIDER=${provider} selected but no real adapter is wired (Gate 0 not cleared) — refusing to move real funds`,
      );
  }
}

// Build a correctly-signed mock callback (for the demo "pay" screen + tests).
export function buildMockCallback(invoiceNo: string, amount: number, respCode = PSP_SUCCESS): PspCallback {
  const signature = signHmac(callbackPayloadString({ invoiceNo, amount, respCode }));
  return { invoiceNo, amount, respCode, signature };
}

// P5 mock callbacks (demo + tests). Signed with the same HMAC secret.
export function buildMockPayoutCallback(batchNo: string, respCode = PSP_SUCCESS): PspPayoutCallback {
  const signature = signHmac(payoutCallbackString({ batchNo, respCode }));
  return { batchNo, respCode, signature };
}
export function buildMockRefundCallback(pspRef: string, amount: number, respCode = PSP_SUCCESS): PspRefundCallback {
  const signature = signHmac(refundCallbackString({ pspRef, amount, respCode }));
  return { pspRef, amount, respCode, signature };
}
