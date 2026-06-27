import { prisma } from "@/lib/db";
import { enqueuePush } from "@/lib/push";

// P7 reminder cron worker. Enqueues (durable PushJob) payment + delivery reminders to buyers.
// Anti-double-remind: the caller's CronLog (reminder, <hour>) dedup caps it to one run per
// hour, so each eligible order falls in exactly one reminder bucket. No per-order flag needed.

// Payment reminders fire when an order is within this window of expiring.
const REMIND_WINDOW_MS = 30 * 60_000; // 30 min before paymentExpiredAt

export interface ReminderResult {
  paymentReminders: number;
  deliveryReminders: number;
}

function dayBounds(d: Date): { start: Date; end: Date } {
  const start = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const end = new Date(start.getTime() + 24 * 60 * 60_000);
  return { start, end };
}

export async function runReminder(now = new Date()): Promise<ReminderResult> {
  // Payment reminder: WAITING_PAYMENT orders expiring within the window (not yet expired).
  const expiringSoon = await prisma.order.findMany({
    where: {
      status: "WAITING_PAYMENT",
      paymentExpiredAt: { gt: now, lte: new Date(now.getTime() + REMIND_WINDOW_MS) },
    },
    include: { buyer: { select: { lineUserId: true } } },
  });

  let paymentReminders = 0;
  for (const o of expiringSoon) {
    const lineUserId = o.buyer.lineUserId;
    if (!lineUserId) continue;
    await prisma.$transaction((tx) =>
      enqueuePush(tx, {
        event: "PAYMENT_REMINDER",
        lineUserId,
        message: `ออเดอร์ ${o.orderNo} ใกล้หมดเวลาชำระเงิน กรุณาชำระภายในเวลาที่กำหนด`,
      }),
    );
    paymentReminders++;
  }

  // Delivery reminder: PAID/PREPARING orders with deliveryDate == tomorrow (date-only match).
  const tomorrow = new Date(now.getTime() + 24 * 60 * 60_000);
  const { start, end } = dayBounds(tomorrow);
  const deliveringTomorrow = await prisma.order.findMany({
    where: {
      status: { in: ["PAID", "PREPARING"] },
      deliveryDate: { gte: start, lt: end },
    },
    include: { buyer: { select: { lineUserId: true } } },
  });

  let deliveryReminders = 0;
  for (const o of deliveringTomorrow) {
    const lineUserId = o.buyer.lineUserId;
    if (!lineUserId) continue;
    await prisma.$transaction((tx) =>
      enqueuePush(tx, {
        event: "DELIVERY_REMINDER",
        lineUserId,
        message: `ออเดอร์ ${o.orderNo} มีกำหนดจัดส่งพรุ่งนี้`,
      }),
    );
    deliveryReminders++;
  }

  return { paymentReminders, deliveryReminders };
}
