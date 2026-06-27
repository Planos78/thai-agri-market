import { NextResponse } from "next/server";

// Parse + validate report window params shared by every report route.
//   from/to: ISO date (YYYY-MM-DD), inclusive day range.
//   from > to -> 400. Missing -> 400.
export interface ReportWindow {
  from: Date;
  to: Date; // exclusive upper bound (end of `to` day)
  orchardId?: string;
}

export function parseWindow(req: Request): ReportWindow | NextResponse {
  const sp = new URL(req.url).searchParams;
  const fromStr = sp.get("from");
  const toStr = sp.get("to");
  if (!fromStr || !toStr) return NextResponse.json({ error: "from and to required (YYYY-MM-DD)" }, { status: 400 });
  const from = new Date(`${fromStr}T00:00:00.000Z`);
  const toDay = new Date(`${toStr}T00:00:00.000Z`);
  if (Number.isNaN(from.getTime()) || Number.isNaN(toDay.getTime())) {
    return NextResponse.json({ error: "invalid date" }, { status: 400 });
  }
  if (from > toDay) return NextResponse.json({ error: "from must be <= to" }, { status: 400 });
  // inclusive `to`: bump to end of that day.
  const to = new Date(toDay.getTime() + 24 * 60 * 60_000);
  const orchardId = sp.get("orchardId") ?? undefined;
  return { from, to, orchardId };
}
