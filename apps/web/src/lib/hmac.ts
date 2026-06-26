import crypto from "node:crypto";

const SECRET = () => process.env.PAYMENT_SECRET_KEY ?? "dev-payment-secret";

export function signHmac(payload: string, secret = SECRET()): string {
  return crypto.createHmac("sha256", secret).update(payload).digest("hex");
}

// Constant-time compare. Returns false on any length/format mismatch.
export function verifyHmac(payload: string, signature: string, secret = SECRET()): boolean {
  const expected = signHmac(payload, secret);
  const a = Buffer.from(expected);
  const b = Buffer.from(signature ?? "");
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}
