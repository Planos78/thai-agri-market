import { round2 } from "@/lib/money";

// P7 reconciliation (Flow 8). READ-ONLY: surfaces variance, never auto-corrects money.
// Identity over a window: every baht IN == paid-to-orchards + refunded-to-customers +
// platform-keeps(fee+vat) + still-held-in-escrow. Balanced ledger -> variance == 0.
// PLANT clawback refunds are EXCLUDED (they recover money INTO the platform; they reduce a
// future payoutsOut, so subtracting them would double-count). Pure fn for unit testing.

export interface ReconRow {
  orderNo: string;
  paidAt: Date | null;
  totalAmount: number; // payments in for this order
  feeVat: number; // platform fee + vat kept
  paidOut: number; // sum of SUCCEEDED payout lines in window
  refunded: number; // sum of SUCCEEDED CUSTOMER refunds in window
  heldEscrow: boolean; // payment escrowStatus == HELD (still in escrow)
}

export interface ReconRowResult extends ReconRow {
  rowVariance: number;
}

export interface ReconTotals {
  paymentsIn: number;
  payoutsOut: number;
  refundsOut: number;
  platformFee: number;
  heldEscrow: number;
  variance: number;
}

export interface ReconResult {
  totals: ReconTotals;
  rows: ReconRowResult[];
}

export function computeReconciliation(rows: ReconRow[]): ReconResult {
  let paymentsIn = 0;
  let payoutsOut = 0;
  let refundsOut = 0;
  let platformFee = 0;
  let heldEscrow = 0;

  const out: ReconRowResult[] = rows.map((r) => {
    const held = r.heldEscrow ? r.totalAmount : 0;
    paymentsIn += r.totalAmount;
    payoutsOut += r.paidOut;
    refundsOut += r.refunded;
    platformFee += r.feeVat;
    heldEscrow += held;
    const rowVariance = round2(r.totalAmount - r.feeVat - r.paidOut - r.refunded - held);
    return { ...r, rowVariance };
  });

  const totals: ReconTotals = {
    paymentsIn: round2(paymentsIn),
    payoutsOut: round2(payoutsOut),
    refundsOut: round2(refundsOut),
    platformFee: round2(platformFee),
    heldEscrow: round2(heldEscrow),
    variance: round2(paymentsIn - payoutsOut - refundsOut - platformFee - heldEscrow),
  };
  return { totals, rows: out };
}
