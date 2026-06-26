import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { getLine } from "@/lib/line";

// Durable push (blueprint bug #5 fix): push is NOT fire-and-forget. A PushJob row is
// the queue. enqueue is atomic with the caller's txn (so a paid-order notification is
// never lost), attempt sends best-effort inline, and a cron sweep retries PENDING jobs.

// Exponential backoff in ms by attempt count (1st retry +1m, 2nd +5m, then +15m).
const BACKOFF_MS = [60_000, 5 * 60_000, 15 * 60_000];

function backoffFor(attempts: number): number {
  return BACKOFF_MS[Math.min(attempts, BACKOFF_MS.length - 1)];
}

export interface EnqueueInput {
  event: string;
  lineUserId: string;
  message: string;
}

// Create a PENDING PushJob inside the caller's transaction. Returns the job id.
export async function enqueuePush(tx: Prisma.TransactionClient, input: EnqueueInput): Promise<string> {
  const job = await tx.pushJob.create({
    data: { event: input.event, lineUserId: input.lineUserId, message: input.message },
  });
  return job.id;
}

export interface AttemptResult {
  status: "SENT" | "PENDING" | "FAILED";
  attempts: number;
}

// Attempt to send one job. Never throws — a send failure becomes job state, not a
// request error. PENDING->SENT on success; PENDING->PENDING(+backoff) on transient
// failure; PENDING->FAILED once attempts reach maxAttempts.
export async function attemptPush(jobId: string): Promise<AttemptResult> {
  const job = await prisma.pushJob.findUnique({ where: { id: jobId } });
  if (!job) return { status: "FAILED", attempts: 0 };
  if (job.status === "SENT") return { status: "SENT", attempts: job.attempts };
  if (job.status === "FAILED") return { status: "FAILED", attempts: job.attempts };

  try {
    await getLine().push(job.lineUserId, `[${job.event}] ${job.message}`);
    await prisma.pushJob.update({
      where: { id: job.id },
      data: { status: "SENT", sentAt: new Date(), attempts: job.attempts + 1, lastError: null },
    });
    return { status: "SENT", attempts: job.attempts + 1 };
  } catch (err) {
    const attempts = job.attempts + 1;
    const exhausted = attempts >= job.maxAttempts;
    await prisma.pushJob.update({
      where: { id: job.id },
      data: {
        attempts,
        lastError: err instanceof Error ? err.message : String(err),
        status: exhausted ? "FAILED" : "PENDING",
        nextAttemptAt: exhausted ? job.nextAttemptAt : new Date(Date.now() + backoffFor(attempts)),
      },
    });
    return { status: exhausted ? "FAILED" : "PENDING", attempts };
  }
}

// Push to every LINE staff bound to an orchard. bug #4: an orchard with zero bindings
// is NOT a silent no-op — it records a FAILED PushJob with lastError="no line binding".
export async function pushToOrchard(
  orchardId: string,
  event: string,
  message: string,
): Promise<{ targeted: number }> {
  const bindings = await prisma.orchardLineBinding.findMany({ where: { orchardId } });
  if (bindings.length === 0) {
    await prisma.pushJob.create({
      data: {
        event,
        lineUserId: `orchard:${orchardId}`,
        message,
        status: "FAILED",
        attempts: 0,
        lastError: "no line binding",
      },
    });
    return { targeted: 0 };
  }
  for (const b of bindings) {
    const jobId = await prisma.$transaction((tx) =>
      enqueuePush(tx, { event, lineUserId: b.lineUserId, message }),
    );
    await attemptPush(jobId);
  }
  return { targeted: bindings.length };
}

export interface SweepResult {
  swept: number;
  sent: number;
  failed: number;
}

// Cron sweep: retry due PENDING jobs (nextAttemptAt <= now). P7 wires Vercel Cron;
// P3 ships the function + a CRON_SECRET-gated route so the queue is exercisable now.
export async function sweepPushJobs(limit = 50): Promise<SweepResult> {
  const due = await prisma.pushJob.findMany({
    where: { status: "PENDING", nextAttemptAt: { lte: new Date() } },
    orderBy: { nextAttemptAt: "asc" },
    take: limit,
  });
  let sent = 0;
  let failed = 0;
  for (const job of due) {
    const r = await attemptPush(job.id);
    if (r.status === "SENT") sent++;
    else if (r.status === "FAILED") failed++;
  }
  return { swept: due.length, sent, failed };
}
