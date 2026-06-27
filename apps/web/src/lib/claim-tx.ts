import type { ClaimCategory, ClaimSeverity } from "@prisma/client";
import { prisma } from "@/lib/db";
import { generateOrderNo } from "@/lib/order-no";
import { assertTransition, type ResolveDecision } from "@/lib/claim";
import { createRefundInTx } from "@/lib/settlement-tx";

// State mutations for P6 claim intake/triage. Every transition is wrapped in prisma.$transaction
// and writes a ClaimEvent in the same tx. Triage/classify/resolve are HUMAN-only (gated at route
// by claims.write). The buyer-file path is the ONLY way to create a claim (status OPEN).
// Claim NEVER moves money itself — RESOLVED + createRefund reuses P5 createRefundInTx atomically.

interface ClaimError {
  error: string;
  status: number;
}
function err(error: string, status: number): ClaimError {
  return { error, status };
}
function isErr(x: unknown): x is ClaimError {
  return typeof x === "object" && x !== null && "error" in x && "status" in x;
}
export { isErr as isClaimError };

// Buyer files a claim with a category + description -> OPEN. actor = lineUserId or buyer phone.
// Guards the buyer owns the order (checked at route). Writes the FILE ClaimEvent in one tx.
export async function fileClaim(opts: {
  orderId: string;
  buyerId?: string | null;
  lineUserId?: string | null;
  category: ClaimCategory;
  description: string;
  actor: string;
}) {
  if (!opts.description || opts.description.trim().length === 0) {
    return err("description required", 422);
  }
  return prisma.$transaction(async (tx) => {
    const claimNo = await generateOrderNo(tx, "CL");
    const claim = await tx.claim.create({
      data: {
        claimNo,
        orderId: opts.orderId,
        buyerId: opts.buyerId ?? null,
        lineUserId: opts.lineUserId ?? null,
        category: opts.category,
        description: opts.description,
        status: "OPEN",
      },
    });
    await tx.claimEvent.create({
      data: { claimId: claim.id, action: "FILE", fromStatus: null, toStatus: "OPEN", actor: opts.actor, note: null },
    });
    return { claim };
  });
}

// Ops picks up a claim (OPEN -> TRIAGING) and may set category/severity/aiFlag suggestions.
// action "CLASSIFY" updates suggestions WITHOUT a status transition (AI/ops allowed); "TRIAGE"
// transitions OPEN -> TRIAGING. Human-only (claims.write). Writes a ClaimEvent.
export async function triageClaim(opts: {
  claimId: string;
  action: "TRIAGE" | "CLASSIFY";
  category?: ClaimCategory;
  severity?: ClaimSeverity;
  aiFlag?: string | null;
  note?: string | null;
  actor: string;
}) {
  return prisma.$transaction(async (tx) => {
    const claim = await tx.claim.findUnique({ where: { id: opts.claimId } });
    if (!claim) return err("claim not found", 404);

    const data: Record<string, unknown> = {};
    if (opts.category !== undefined) data.category = opts.category;
    if (opts.severity !== undefined) data.severity = opts.severity;
    if (opts.aiFlag !== undefined) data.aiFlag = opts.aiFlag;

    if (opts.action === "CLASSIFY") {
      // Suggestion-only: no status change (AI/ops may classify/flag, never transition).
      const updated = await tx.claim.update({ where: { id: claim.id }, data });
      const event = await tx.claimEvent.create({
        data: { claimId: claim.id, action: "CLASSIFY", fromStatus: claim.status, toStatus: claim.status, actor: opts.actor, note: opts.note ?? null },
      });
      return { claim: updated, event };
    }

    // TRIAGE: OPEN -> TRIAGING.
    const blocked = assertTransition(claim.status, "TRIAGING");
    if (blocked) return err(blocked.error, blocked.status);
    const updated = await tx.claim.update({ where: { id: claim.id }, data: { ...data, status: "TRIAGING" } });
    const event = await tx.claimEvent.create({
      data: { claimId: claim.id, action: "TRIAGE", fromStatus: claim.status, toStatus: "TRIAGING", actor: opts.actor, note: opts.note ?? null },
    });
    return { claim: updated, event };
  });
}

// Human triage decision: RESOLVED | REJECTED | ESCALATED (state machine enforced). On RESOLVED
// with createRefund, reuse P5 createRefundInTx (CUSTOMER, PENDING) in THIS tx and link
// Refund.claimId 1:1. Claim never moves money itself. Human-only (claims.write).
export async function resolveClaim(opts: {
  claimId: string;
  decision: ResolveDecision;
  note?: string | null;
  createRefund?: boolean;
  refundKind?: "FULL" | "PARTIAL";
  refundAmount?: number | null;
  actor: string;
}) {
  try {
    return await prisma.$transaction(async (tx) => {
      const claim = await tx.claim.findUnique({ where: { id: opts.claimId } });
      if (!claim) return err("claim not found", 404);

      const blocked = assertTransition(claim.status, opts.decision);
      if (blocked) return err(blocked.error, blocked.status);

      const action = opts.decision === "RESOLVED" ? "RESOLVE" : opts.decision === "REJECTED" ? "REJECT" : "ESCALATE";
      const isResolved = opts.decision === "RESOLVED";

      const updated = await tx.claim.update({
        where: { id: claim.id },
        data: {
          status: opts.decision,
          ...(isResolved ? { resolvedBy: opts.actor, resolvedAt: new Date() } : {}),
        },
      });
      const event = await tx.claimEvent.create({
        data: { claimId: claim.id, action, fromStatus: claim.status, toStatus: opts.decision, actor: opts.actor, note: opts.note ?? null },
      });

      let refund = null;
      if (isResolved && opts.createRefund) {
        const existing = await tx.refund.findUnique({ where: { claimId: claim.id } });
        if (existing) return err("claim already has a refund", 409);
        const r = await createRefundInTx(tx, {
          orderId: claim.orderId,
          kind: opts.refundKind ?? "PARTIAL",
          amount: opts.refundAmount ?? null,
          payoutType: "CUSTOMER",
          approvedBy: opts.actor,
          claimId: claim.id,
        });
        // BUG-P6: a refund failure here happens AFTER the claim update + event were written in
        // this tx. Returning the error commits Prisma's interactive tx (only a throw rolls back),
        // which would leave the claim RESOLVED with no refund. Throw a tagged error to force the
        // whole tx to roll back, then convert it back to the {error,status} shape outside.
        if (isClaimRefundErr(r)) throw new ClaimTxAbort(r.error, r.status);
        refund = r.refund;
      }

      return { claim: updated, event, refund };
    });
  } catch (e) {
    if (e instanceof ClaimTxAbort) return err(e.message, e.status);
    throw e;
  }
}

// Carries an {error,status} out of a $transaction via throw so Prisma rolls back the writes
// already made in the same tx (claim update + event), then is converted back to the error shape.
class ClaimTxAbort extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = "ClaimTxAbort";
  }
}

// createRefundInTx returns {refund} | {error,status}; narrow the error shape.
function isClaimRefundErr(x: unknown): x is { error: string; status: number } {
  return typeof x === "object" && x !== null && "error" in x && "status" in x;
}
