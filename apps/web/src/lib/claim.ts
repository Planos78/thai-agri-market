// Pure claim state-machine logic (P6 Flow 7). No DB — unit-testable.
// Buyer files -> AI/ops classify+flag (allowed) -> human triage/resolve (human-only at route).
// AI may set aiFlag/category/severity suggestions but may NEVER transition status.

import type { ClaimStatus } from "@prisma/client";

// Allowed transitions. OPEN -> TRIAGING|REJECTED; TRIAGING -> RESOLVED|REJECTED|ESCALATED;
// ESCALATED -> RESOLVED|REJECTED. RESOLVED/REJECTED are terminal (no transition out).
const TRANSITIONS: Record<ClaimStatus, ClaimStatus[]> = {
  OPEN: ["TRIAGING", "REJECTED"],
  TRIAGING: ["RESOLVED", "REJECTED", "ESCALATED"],
  ESCALATED: ["RESOLVED", "REJECTED"],
  RESOLVED: [],
  REJECTED: [],
};

export const TERMINAL: ClaimStatus[] = ["RESOLVED", "REJECTED"];

export function isTerminal(status: ClaimStatus): boolean {
  return TERMINAL.includes(status);
}

export function canTransition(from: ClaimStatus, to: ClaimStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

// Resolve-decision -> target status. Triage (pick up) moves OPEN -> TRIAGING.
export type ResolveDecision = "RESOLVED" | "REJECTED" | "ESCALATED";

// Validate a transition; returns null if allowed, else an {error,status} reason.
// 409 for an illegal/terminal transition (matches existing decide-route conventions).
export function assertTransition(
  from: ClaimStatus,
  to: ClaimStatus,
): { error: string; status: number } | null {
  if (isTerminal(from)) {
    return { error: `claim is terminal (${from}); no further transition`, status: 409 };
  }
  if (!canTransition(from, to)) {
    return { error: `illegal transition ${from} -> ${to}`, status: 409 };
  }
  return null;
}
