import { NextResponse } from "next/server";
import { relayPush } from "@/lib/line";

// Internal push relay endpoint (roadmap note 4). App code POSTs here instead of
// calling LINE directly. Optionally gated by INTERNAL_PUSH_SECRET.
export async function POST(req: Request, { params }: { params: Promise<{ event: string }> }) {
  const { event } = await params;
  const secret = process.env.INTERNAL_PUSH_SECRET;
  if (secret && req.headers.get("x-internal-secret") !== secret) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const { lineUserId, message } = await req.json();
  if (!lineUserId) return NextResponse.json({ error: "lineUserId required" }, { status: 400 });
  await relayPush(event, lineUserId, message ?? "");
  return NextResponse.json({ ok: true });
}
