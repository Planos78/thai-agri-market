export function isBuyable(lot: { status: string; qcStatus: string }): boolean {
  return lot.status === "ACTIVE" && lot.qcStatus === "RELEASED";
}
