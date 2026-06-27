import { round2 } from "@/lib/money";

// P7 reports. Pure aggregation fns (unit-tested) over plain row shapes; the API routes do
// the DB read + scope filter and pass rows here. Money summed in number, normalized via round2.

// Withholding tax = WHT_RATE (env, default 3%) of the platform SERVICE FEE (feeAmount).
// Computed, not stored; flagged unaudited in the route. Real WHT certs are deferred.
export function whtRate(): number {
  return Number(process.env.WHT_RATE ?? "0.03");
}

export function computeWht(feeAmount: number, rate = whtRate()): number {
  return round2(feeAmount * rate);
}

export interface RevenueRow {
  orchardId: string;
  orchardName: string;
  subTotal: number;
  feeAmount: number;
  vatFeeAmount: number;
}

export interface RevenueReport {
  totals: { subTotal: number; feeAmount: number; vatFeeAmount: number; gross: number };
  byOrchard: { orchardId: string; name: string; subTotal: number; fee: number; vat: number }[];
}

export function aggregateRevenue(rows: RevenueRow[]): RevenueReport {
  const byId = new Map<string, { name: string; subTotal: number; fee: number; vat: number }>();
  let subTotal = 0;
  let feeAmount = 0;
  let vatFeeAmount = 0;
  for (const r of rows) {
    subTotal += r.subTotal;
    feeAmount += r.feeAmount;
    vatFeeAmount += r.vatFeeAmount;
    const cur = byId.get(r.orchardId) ?? { name: r.orchardName, subTotal: 0, fee: 0, vat: 0 };
    cur.subTotal += r.subTotal;
    cur.fee += r.feeAmount;
    cur.vat += r.vatFeeAmount;
    byId.set(r.orchardId, cur);
  }
  return {
    totals: {
      subTotal: round2(subTotal),
      feeAmount: round2(feeAmount),
      vatFeeAmount: round2(vatFeeAmount),
      gross: round2(subTotal + feeAmount + vatFeeAmount),
    },
    byOrchard: [...byId.entries()].map(([orchardId, v]) => ({
      orchardId,
      name: v.name,
      subTotal: round2(v.subTotal),
      fee: round2(v.fee),
      vat: round2(v.vat),
    })),
  };
}

export interface WhtRow {
  orchardId: string;
  orchardName: string;
  feeAmount: number;
}

export interface WhtReport {
  whtRate: number;
  totalFee: number;
  totalWht: number;
  byOrchard: { orchardId: string; name: string; fee: number; wht: number }[];
  computed: true;
}

export function aggregateWht(rows: WhtRow[], rate = whtRate()): WhtReport {
  const byId = new Map<string, { name: string; fee: number }>();
  let totalFee = 0;
  for (const r of rows) {
    totalFee += r.feeAmount;
    const cur = byId.get(r.orchardId) ?? { name: r.orchardName, fee: 0 };
    cur.fee += r.feeAmount;
    byId.set(r.orchardId, cur);
  }
  return {
    whtRate: rate,
    totalFee: round2(totalFee),
    totalWht: computeWht(totalFee, rate),
    byOrchard: [...byId.entries()].map(([orchardId, v]) => ({
      orchardId,
      name: v.name,
      fee: round2(v.fee),
      wht: computeWht(v.fee, rate),
    })),
    computed: true,
  };
}

export interface RefundRow {
  refundNo: string;
  orderNo: string;
  amount: number;
  kind: string;
  payoutType: "CUSTOMER" | "PLANT";
  settledAt: Date | null;
}

export interface RefundReport {
  totalRefunded: number; // CUSTOMER only (money out the door)
  customerRefunds: number;
  plantClawbacks: number;
  rows: RefundRow[];
}

export function aggregateRefunds(rows: RefundRow[]): RefundReport {
  let customer = 0;
  let plant = 0;
  for (const r of rows) {
    if (r.payoutType === "PLANT") plant += r.amount;
    else customer += r.amount;
  }
  return {
    totalRefunded: round2(customer),
    customerRefunds: round2(customer),
    plantClawbacks: round2(plant),
    rows,
  };
}

// CSV: header + rows. Values escaped (quote + double inner quotes) so commas/quotes are safe.
export function toCsv(headers: string[], rows: (string | number | null)[][]): string {
  const esc = (v: string | number | null) => {
    const s = v === null || v === undefined ? "" : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [headers.join(","), ...rows.map((r) => r.map(esc).join(","))].join("\n");
}
