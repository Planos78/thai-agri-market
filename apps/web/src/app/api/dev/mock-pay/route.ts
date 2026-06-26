import { NextResponse } from "next/server";
import { buildMockCallback } from "@/lib/psp";

// DEV-ONLY: simulates the PSP firing its signed callback. Mock provider only.
export async function POST(req: Request) {
  if ((process.env.PSP_PROVIDER ?? "mock") !== "mock") {
    return NextResponse.json({ error: "mock-pay disabled (real PSP)" }, { status: 400 });
  }
  const { invoiceNo, amount } = await req.json();
  if (!invoiceNo) return NextResponse.json({ error: "invoiceNo required" }, { status: 400 });

  const callback = buildMockCallback(invoiceNo, Number(amount));
  const res = await fetch(new URL("/api/interface/payment/callback", req.url), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(callback),
  });
  return NextResponse.json({ forwarded: res.ok, status: res.status });
}
