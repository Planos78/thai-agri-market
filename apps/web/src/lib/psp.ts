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

export interface PspAdapter {
  initPayment(input: { orderNo: string; amount: number }): Promise<PspInitResult>;
}

export const PSP_SUCCESS = "2000";

// Canonical string the PSP signs / we verify. Keep stable across mock + real.
export function callbackPayloadString(c: { invoiceNo: string; amount: number; respCode: string }): string {
  return `${c.invoiceNo}|${c.amount}|${c.respCode}`;
}

class MockPsp implements PspAdapter {
  async initPayment({ orderNo, amount }: { orderNo: string; amount: number }): Promise<PspInitResult> {
    return {
      paymentUrl: `/mock-psp/pay?invoice=${encodeURIComponent(orderNo)}&amount=${amount}`,
      invoiceNo: orderNo,
      providerRef: `MOCK-${orderNo}`,
    };
  }
}

export function getPsp(): PspAdapter {
  switch (process.env.PSP_PROVIDER ?? "mock") {
    case "mock":
    default:
      return new MockPsp();
  }
}

// Build a correctly-signed mock callback (for the demo "pay" screen + tests).
export function buildMockCallback(invoiceNo: string, amount: number, respCode = PSP_SUCCESS): PspCallback {
  const signature = signHmac(callbackPayloadString({ invoiceNo, amount, respCode }));
  return { invoiceNo, amount, respCode, signature };
}
