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

// LINE webhook signature: base64( HMAC-SHA256(channelSecret, rawBody) ).
// Computed over the RAW request body (no re-serialization). Constant-time compare;
// returns false on any length/format mismatch.
export function verifyLineSignature(rawBody: string, signature: string, secret: string): boolean {
  if (!secret) return false;
  const expected = crypto.createHmac("sha256", secret).update(rawBody, "utf8").digest("base64");
  const a = Buffer.from(expected);
  const b = Buffer.from(signature ?? "");
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}
