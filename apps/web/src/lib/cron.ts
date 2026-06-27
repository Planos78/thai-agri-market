import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";

// P7 cron infrastructure: CRON_SECRET auth (mirrors push-sweep) + CronLog (task,period)
// dedup. The dedup is an atomic claim: the first caller create()s the row; a duplicate
// fire collides on @@unique([task,period]) -> P2002 -> we skip. Vercel Cron retries and
// double-fires become no-ops by construction.

// Verify the cron secret (Vercel Cron sends `authorization: Bearer <CRON_SECRET>`; we also
// accept `x-cron-secret`). Blank secret = open (dev). Identical shape to push-sweep route.
export function cronAuthorized(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return true;
  const auth = req.headers.get("authorization");
  const header = req.headers.get("x-cron-secret");
  return auth === `Bearer ${secret}` || header === secret;
}

// Bucket `now` into a period key for the job's cadence.
//   daily  -> "2026-06-27"
//   hourly -> "2026-06-27T14"
//   5min   -> "2026-06-27T1405" (minute floored to the 5-min slot)
export type Cadence = "daily" | "hourly" | "5min";

export function periodKey(now: Date, cadence: Cadence): string {
  const y = now.getUTCFullYear();
  const mo = String(now.getUTCMonth() + 1).padStart(2, "0");
  const d = String(now.getUTCDate()).padStart(2, "0");
  const day = `${y}-${mo}-${d}`;
  if (cadence === "daily") return day;
  const h = String(now.getUTCHours()).padStart(2, "0");
  if (cadence === "hourly") return `${day}T${h}`;
  const slot = Math.floor(now.getUTCMinutes() / 5) * 5;
  const mm = String(slot).padStart(2, "0");
  return `${day}T${h}${mm}`;
}

export interface CronClaim {
  skipped: boolean;
  logId?: string;
}

// Atomically claim a (task, period). Returns skipped:true if another run already claimed it.
export async function claimCronPeriod(task: string, period: string): Promise<CronClaim> {
  try {
    const row = await prisma.cronLog.create({ data: { task, period, status: "RUNNING" } });
    return { skipped: false, logId: row.id };
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      return { skipped: true };
    }
    throw err;
  }
}

export async function finishCron(logId: string, status: "DONE" | "FAILED", note?: unknown): Promise<void> {
  await prisma.cronLog
    .update({
      where: { id: logId },
      data: { status, note: note === undefined ? undefined : JSON.stringify(note) },
    })
    .catch(() => {
      /* best-effort; do not mask the job result */
    });
}
