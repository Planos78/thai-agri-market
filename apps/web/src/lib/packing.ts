// Pure packing/manifest reconcile logic (P6 Flow 6). No DB — unit-testable.
// Count/label reconcile before logistics handoff; human sign-off required.
// AI may compute/flag variance here, but never sign off (that's a route + perm gate).

import type { PackingStatus } from "@prisma/client";

export interface PackingLine {
  expectedQty: number;
  packedQty: number;
}

export interface Reconciled {
  expectedCount: number;
  packedCount: number;
  hasVariance: boolean;
  status: Extract<PackingStatus, "RECONCILED" | "VARIANCE">;
}

// expectedCount = sum(expectedQty); packedCount = sum(packedQty);
// hasVariance = any line where packedQty != expectedQty.
export function reconcile(lines: PackingLine[]): Reconciled {
  const expectedCount = lines.reduce((s, l) => s + l.expectedQty, 0);
  const packedCount = lines.reduce((s, l) => s + l.packedQty, 0);
  const hasVariance = lines.some((l) => l.packedQty !== l.expectedQty);
  return {
    expectedCount,
    packedCount,
    hasVariance,
    status: hasVariance ? "VARIANCE" : "RECONCILED",
  };
}

// Sign-off guard. Cannot move to SIGNED_OFF from OPEN (must reconcile first).
// A VARIANCE manifest can be signed off only with a non-empty note (human override, audited).
// Returns null if allowed, else an {error,status} reason.
export function canSignOff(
  status: PackingStatus,
  note: string | null | undefined,
): { error: string; status: number } | null {
  if (status === "OPEN") return { error: "cannot sign off an OPEN manifest (reconcile first)", status: 409 };
  if (status === "SIGNED_OFF") return { error: "manifest already signed off", status: 409 };
  if (status === "VARIANCE" && !(note && note.trim().length > 0)) {
    return { error: "a VARIANCE manifest requires a note to sign off", status: 422 };
  }
  return null;
}
