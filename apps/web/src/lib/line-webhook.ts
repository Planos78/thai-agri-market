import { prisma } from "@/lib/db";
import { enqueuePush, attemptPush } from "@/lib/push";

// LINE webhook event handling (bug #6: bot state is DB-backed, no in-memory map).
// Register-code redeem binds a LINE staff user to an orchard (bug #10: FK to Orchard).

// A register code looks like REG-XXXX (case-insensitive). Returns the matched code or null.
const REGISTER_CODE_RE = /\b(REG-[A-Za-z0-9]+)\b/i;

export function extractRegisterCode(text: string | null | undefined): string | null {
  if (!text) return null;
  const m = text.match(REGISTER_CODE_RE);
  return m ? m[1].toUpperCase() : null;
}

export type RedeemResult =
  | { ok: true; orchardId: string; alreadyBound: boolean }
  | { ok: false; reason: "unknown" | "redeemed" | "expired" };

// Redeem a register code in a transaction: validate, mark redeemed, upsert the binding.
// Atomic with the unique `code` constraint so concurrent redeems can't double-bind.
export async function redeemRegisterCode(code: string, lineUserId: string): Promise<RedeemResult> {
  return prisma.$transaction(async (tx) => {
    const normalized = code.toUpperCase();
    const rc = await tx.orchardRegisterCode.findUnique({ where: { code: normalized } });
    if (!rc) return { ok: false, reason: "unknown" as const };
    if (rc.redeemedAt) return { ok: false, reason: "redeemed" as const };
    if (rc.expiresAt && rc.expiresAt.getTime() <= Date.now()) {
      return { ok: false, reason: "expired" as const };
    }

    await tx.orchardRegisterCode.update({
      where: { id: rc.id },
      data: { redeemedAt: new Date(), redeemedBy: lineUserId },
    });
    const existing = await tx.orchardLineBinding.findUnique({
      where: { orchardId_lineUserId: { orchardId: rc.orchardId, lineUserId } },
    });
    if (!existing) {
      await tx.orchardLineBinding.create({ data: { orchardId: rc.orchardId, lineUserId } });
    }
    return { ok: true as const, orchardId: rc.orchardId, alreadyBound: !!existing };
  });
}

export interface LineEvent {
  type: string;
  replyToken?: string;
  source?: { userId?: string };
  message?: { type?: string; text?: string };
}

// Process one webhook event: write a LineBotLog row, and handle register-code redeem
// for text messages. Returns whether the event was handled (redeem attempted).
export async function handleLineEvent(event: LineEvent): Promise<{ handled: boolean }> {
  const lineUserId = event.source?.userId ?? null;
  const text = event.message?.text ?? null;
  const code = event.type === "message" ? extractRegisterCode(text) : null;

  await prisma.lineBotLog.create({
    data: {
      lineUserId,
      eventType: event.type,
      replyToken: event.replyToken ?? null,
      text,
      rawEvent: JSON.stringify(event),
      handled: !!code,
    },
  });

  if (!code || !lineUserId) return { handled: false };

  const result = await redeemRegisterCode(code, lineUserId);
  // After commit, enqueue a confirmation/error push (durable, never fire-and-forget).
  const msg = result.ok
    ? `ผูกบัญชีกับสวนเรียบร้อยแล้ว`
    : result.reason === "redeemed"
      ? `รหัสนี้ถูกใช้ไปแล้ว`
      : result.reason === "expired"
        ? `รหัสหมดอายุแล้ว`
        : `ไม่พบรหัสนี้`;
  const jobId = await prisma.$transaction((tx) =>
    enqueuePush(tx, { event: "register-redeem", lineUserId, message: msg }),
  );
  await attemptPush(jobId);
  return { handled: result.ok };
}
