import { NextResponse } from "next/server";
import { cronAuthorized, periodKey, claimCronPeriod, finishCron } from "@/lib/cron";
import { runExpirySweep } from "@/lib/expiry-sweep";

// P7 cron: expire WAITING_PAYMENT orders past paymentExpiredAt (Order->EXPIRED, Payment->
// FAILED/REFUNDED, in $transaction). CRON_SECRET-gated (mirror push-sweep). CronLog dedup on
// the 5-min slot: a duplicate fire in the same slot returns skipped:true. Doubly idempotent —
// even forced, the work only touches orders still WAITING_PAYMENT.
async function handle(req: Request) {
  if (!cronAuthorized(req)) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const now = new Date();
  const period = periodKey(now, "5min");
  const claim = await claimCronPeriod("expiry-sweep", period);
  if (claim.skipped) return NextResponse.json({ skipped: true, reason: "already-run", period });

  try {
    const result = await runExpirySweep(now);
    await finishCron(claim.logId!, "DONE", result);
    return NextResponse.json({ ...result, period });
  } catch (err) {
    await finishCron(claim.logId!, "FAILED", { error: err instanceof Error ? err.message : String(err) });
    return NextResponse.json({ error: "sweep failed" }, { status: 500 });
  }
}

export async function POST(req: Request) {
  return handle(req);
}

export async function GET(req: Request) {
  return handle(req);
}
