import { NextResponse } from "next/server";
import { verifyLineSignature } from "@/lib/hmac";
import { handleLineEvent, type LineEvent } from "@/lib/line-webhook";

// LINE Messaging API webhook. Signature is verified over the RAW body BEFORE any DB
// access (mirror payment-callback AC4 -> reject 401, zero writes on bad sig). Mock mode
// (LINE_PROVIDER=mock) skips the check for dev; prod (LINE_PROVIDER=line) always enforces.
export async function POST(req: Request) {
  const raw = await req.text();
  const provider = process.env.LINE_PROVIDER ?? "mock";
  const secret = process.env.LINE_CHANNEL_SECRET;

  if (provider !== "mock") {
    const sig = req.headers.get("x-line-signature") ?? "";
    if (!secret || !verifyLineSignature(raw, sig, secret)) {
      return NextResponse.json({ error: "bad signature" }, { status: 401 });
    }
  }

  let body: { events?: LineEvent[] };
  try {
    body = JSON.parse(raw || "{}");
  } catch {
    return NextResponse.json({ error: "bad json" }, { status: 400 });
  }

  const events = Array.isArray(body.events) ? body.events : [];
  for (const event of events) {
    await handleLineEvent(event);
  }
  // Always 200 to LINE once the signature is accepted (LINE retries non-2xx).
  return NextResponse.json({ ok: true });
}
