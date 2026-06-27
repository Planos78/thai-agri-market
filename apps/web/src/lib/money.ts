// Money math. Take-rate + VAT are configurable (roadmap §5 rule 9 — no hardcoded 2%).
// P1 computes in number; persisted as Prisma Decimal. P5 sources rates from the active
// PlatformConfig row (env is bootstrap fallback). Pure fns keep explicit rate args.

export const TAKE_RATE = () => Number(process.env.PLATFORM_TAKE_RATE ?? "0.10");
export const VAT_RATE = () => Number(process.env.VAT_RATE ?? "0.07");

// P5: resolve the active platform rates. Reads the single active PlatformConfig row;
// falls back to env if none exists (keeps P1-P4 working before the row is seeded).
// Kept async + DB-backed so the resolver is the only impure part; calcFee stays pure.
export async function getRates(): Promise<{ takeRate: number; vatRate: number }> {
  const { prisma } = await import("@/lib/db");
  const cfg = await prisma.platformConfig.findFirst({
    where: { isActive: true },
    orderBy: { createdAt: "desc" },
  });
  if (!cfg) return { takeRate: TAKE_RATE(), vatRate: VAT_RATE() };
  return { takeRate: Number(cfg.takeRate), vatRate: Number(cfg.vatRate) };
}

export function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

export interface LineInput {
  quantity: number;
  price: number;
}

export function calcSubTotal(lines: LineInput[], deliveryFee = 0): number {
  const items = lines.reduce((s, l) => s + l.quantity * l.price, 0);
  return round2(items + deliveryFee);
}

export function calcFee(subTotal: number, takeRate = TAKE_RATE(), vatRate = VAT_RATE()) {
  const feeAmount = round2(subTotal * takeRate);
  const vatFeeAmount = round2(feeAmount * vatRate);
  return { feeAmount, vatFeeAmount };
}

// transfer_amount = max(0, total - platform_fee - platform_vat - refund) (roadmap §3.4).
// P5 OBS-1 fix: clamp to >= 0. A negative computed payout means fee+VAT exceed what's
// left after refund -> orchard is paid 0, never a negative. Over-refund beyond `transfer`
// is a CUSTOMER refund obligation (tracked by Refund), not a negative payout.
export function calcTransferAmount(total: number, feeAmount: number, vatFeeAmount: number, refund = 0): number {
  return Math.max(0, round2(total - feeAmount - vatFeeAmount - refund));
}
