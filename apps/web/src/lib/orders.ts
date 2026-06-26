// Order expiry helper. P1 uses lazy-check on read; a cron sweep (P7) flips
// stale WAITING_PAYMENT orders to EXPIRED in bulk.
export function isOrderExpired(
  order: { status: string; paymentExpiredAt: Date | null },
  now: Date = new Date(),
): boolean {
  if (order.status !== "WAITING_PAYMENT") return false;
  if (!order.paymentExpiredAt) return false;
  return now.getTime() > order.paymentExpiredAt.getTime();
}

export const HOLD_MS = 60 * 60 * 1000; // 1h hold (roadmap §5 rule 7)
