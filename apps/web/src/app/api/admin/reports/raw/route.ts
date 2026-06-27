import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requirePerm, scopedOrchardIds, inScope } from "@/lib/rbac";
import { parseWindow } from "@/lib/report-params";
import { toCsv } from "@/lib/reports";

// P7 raw export: line-per-order ledger over the window (paidAt). format=json|csv (default json).
// Orchard-scoped. Large exports should paginate (deferred per spec).
const HEADERS = [
  "orderNo",
  "paidAt",
  "status",
  "subTotal",
  "feeAmount",
  "vatFeeAmount",
  "totalAmount",
  "transferAmount",
  "refundedAmount",
  "channel",
  "providerRef",
];

export async function GET(req: Request) {
  const claims = await requirePerm(req, "reports.read");
  if (claims instanceof NextResponse) return claims;
  const win = parseWindow(req);
  if (win instanceof NextResponse) return win;
  const scope = await scopedOrchardIds(claims);
  const format = new URL(req.url).searchParams.get("format") ?? "json";

  const orders = await prisma.order.findMany({
    where: { paidAt: { gte: win.from, lt: win.to } },
    select: {
      orderNo: true,
      paidAt: true,
      status: true,
      subTotal: true,
      feeAmount: true,
      vatFeeAmount: true,
      totalAmount: true,
      transferAmount: true,
      refundedAmount: true,
      payment: { select: { channel: true, providerRef: true } },
      items: { select: { lot: { select: { orchardId: true } } } },
    },
    orderBy: { paidAt: "desc" },
  });

  const rows = orders
    .filter((o) => {
      const oid = o.items[0]?.lot.orchardId;
      if (!oid) return false;
      if (win.orchardId && oid !== win.orchardId) return false;
      return inScope(scope, oid);
    })
    .map((o) => ({
      orderNo: o.orderNo,
      paidAt: o.paidAt,
      status: o.status,
      subTotal: Number(o.subTotal),
      feeAmount: Number(o.feeAmount),
      vatFeeAmount: Number(o.vatFeeAmount),
      totalAmount: Number(o.totalAmount),
      transferAmount: o.transferAmount === null ? null : Number(o.transferAmount),
      refundedAmount: Number(o.refundedAmount),
      channel: o.payment?.channel ?? null,
      providerRef: o.payment?.providerRef ?? null,
    }));

  if (format === "csv") {
    const csv = toCsv(
      HEADERS,
      rows.map((r) => [
        r.orderNo,
        r.paidAt ? r.paidAt.toISOString() : "",
        r.status,
        r.subTotal,
        r.feeAmount,
        r.vatFeeAmount,
        r.totalAmount,
        r.transferAmount,
        r.refundedAmount,
        r.channel,
        r.providerRef,
      ]),
    );
    return new NextResponse(csv, {
      status: 200,
      headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": 'attachment; filename="raw-export.csv"' },
    });
  }

  return NextResponse.json({ from: win.from, to: win.to, rows });
}
