import { NextResponse } from "next/server";
import { cronAuthorized, periodKey, claimCronPeriod, finishCron } from "@/lib/cron";
import { runReminder } from "@/lib/reminder";

// P7 cron: payment + delivery reminders (enqueue durable PushJob only; no money mutation).
// CRON_SECRET-gated (mirror push-sweep). CronLog dedup on the hour so re-runs in the same
// period are skipped -> no double push.
async function handle(req: Request) {
  if (!cronAuthorized(req)) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const now = new Date();
  const period = periodKey(now, "hourly");
  const claim = await claimCronPeriod("reminder", period);
  if (claim.skipped) return NextResponse.json({ skipped: true, reason: "already-run", period });

  try {
    const result = await runReminder(now);
    await finishCron(claim.logId!, "DONE", result);
    return NextResponse.json({ ...result, period });
  } catch (err) {
    await finishCron(claim.logId!, "FAILED", { error: err instanceof Error ? err.message : String(err) });
    return NextResponse.json({ error: "reminder failed" }, { status: 500 });
  }
}

export async function POST(req: Request) {
  return handle(req);
}

export async function GET(req: Request) {
  return handle(req);
}
