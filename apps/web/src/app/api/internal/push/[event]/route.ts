import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { enqueuePush, attemptPush } from "@/lib/push";

// Internal push relay endpoint (roadmap note 4). App code POSTs here instead of
// calling LINE directly. Optionally gated by INTERNAL_PUSH_SECRET. Durable: enqueues
// a PushJob (own short txn) then attempts it; never fire-and-forget (bug #5).
export async function POST(req: Request, { params }: { params: Promise<{ event: string }> }) {
  const { event } = await params;
  const secret = process.env.INTERNAL_PUSH_SECRET;
  if (secret && req.headers.get("x-internal-secret") !== secret) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const { lineUserId, message } = await req.json();
  if (!lineUserId) return NextResponse.json({ error: "lineUserId required" }, { status: 400 });

  const jobId = await prisma.$transaction((tx) =>
    enqueuePush(tx, { event, lineUserId, message: message ?? "" }),
  );
  const result = await attemptPush(jobId);
  return NextResponse.json({ ok: true, jobId, status: result.status });
}
