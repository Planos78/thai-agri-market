import type { Prisma } from "@prisma/client";

// YYMMDD in Asia/Bangkok (roadmap §8: all scheduling/date logic in Bangkok TZ).
export function bangkokYymmdd(d = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Bangkok",
    year: "2-digit",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)!.value;
  return `${get("year")}${get("month")}${get("day")}`;
}

// Pure formatter — unit-testable without a DB.
export function formatOrderNo(prefix: string, ymd: string, n: number): string {
  return `${prefix}${ymd}${String(n).padStart(3, "0")}`;
}

// Concurrency-safe order number: <prefix>+YYMMDD+3digit.
// Counter row locked with SELECT ... FOR UPDATE inside the caller's transaction
// (preserves blueprint bug #2 = keep the lock). Must be called inside prisma.$transaction.
export async function generateOrderNo(
  tx: Prisma.TransactionClient,
  prefix = "S",
): Promise<string> {
  const ymd = bangkokYymmdd();
  const key = `${prefix}${ymd}`;
  await tx.$executeRaw`
    INSERT INTO "OrderRunningNo" ("prefix", "yymmdd", "lastNumber", "updatedAt")
    VALUES (${key}, ${ymd}, 0, now())
    ON CONFLICT ("prefix") DO NOTHING`;
  const rows = await tx.$queryRaw<{ lastNumber: number }[]>`
    SELECT "lastNumber" FROM "OrderRunningNo" WHERE "prefix" = ${key} FOR UPDATE`;
  const next = (rows[0]?.lastNumber ?? 0) + 1;
  await tx.$executeRaw`
    UPDATE "OrderRunningNo" SET "lastNumber" = ${next}, "updatedAt" = now() WHERE "prefix" = ${key}`;
  return formatOrderNo(prefix, ymd, next);
}
