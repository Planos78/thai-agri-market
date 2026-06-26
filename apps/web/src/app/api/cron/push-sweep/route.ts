import { NextResponse } from "next/server";
import { sweepPushJobs } from "@/lib/push";

// Cron sweep: retry due PENDING PushJobs (bug #5 durability). CRON_SECRET-gated.
// P7 wires Vercel Cron; in dev this can be triggered manually. Accepts the secret via
// `authorization: Bearer <CRON_SECRET>` (Vercel Cron convention) or `x-cron-secret`.
async function handle(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const auth = req.headers.get("authorization");
    const header = req.headers.get("x-cron-secret");
    const ok = auth === `Bearer ${secret}` || header === secret;
    if (!ok) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const result = await sweepPushJobs();
  return NextResponse.json(result);
}

export async function POST(req: Request) {
  return handle(req);
}

export async function GET(req: Request) {
  return handle(req);
}
