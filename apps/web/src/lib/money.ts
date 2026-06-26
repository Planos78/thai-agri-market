// Money math. Take-rate + VAT are configurable (roadmap §5 rule 9 — no hardcoded 2%).
// P1 computes in number; persisted as Prisma Decimal. Payout (P5) is out of scope.

export const TAKE_RATE = () => Number(process.env.PLATFORM_TAKE_RATE ?? "0.10");
export const VAT_RATE = () => Number(process.env.VAT_RATE ?? "0.07");

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

// transfer_amount = total - platform_fee - platform_vat - refund (roadmap §3.4 contract).
export function calcTransferAmount(total: number, feeAmount: number, vatFeeAmount: number, refund = 0): number {
  return round2(total - feeAmount - vatFeeAmount - refund);
}
