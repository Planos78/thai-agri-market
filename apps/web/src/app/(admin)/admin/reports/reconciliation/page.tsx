"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";

interface ReconTotals {
  paymentsIn: number;
  payoutsOut: number;
  refundsOut: number;
  platformFee: number;
  heldEscrow: number;
  variance: number;
}
interface ReconRow {
  orderNo: string;
  totalAmount: number;
  feeVat: number;
  paidOut: number;
  refunded: number;
  rowVariance: number;
}
interface ReconResp {
  totals: ReconTotals;
  rows: ReconRow[];
}

// P7 reconciliation console: live variance over a window. Red banner unless variance == 0.
// READ-ONLY; "freeze" writes only a snapshot for audit (perm reconciliation.write).
export default function AdminReconciliation() {
  const router = useRouter();
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [data, setData] = useState<ReconResp | null>(null);
  const [msg, setMsg] = useState("");

  function token(): string {
    const t = sessionStorage.getItem("adminToken");
    if (!t) router.push("/admin/login");
    return t ?? "";
  }

  async function run() {
    setMsg("");
    const res = await fetch(`/api/admin/reports/reconciliation?from=${from}&to=${to}`, {
      headers: { authorization: `Bearer ${token()}` },
    });
    const d = await res.json();
    if (!res.ok) {
      setMsg(d.error ?? "error");
      setData(null);
      return;
    }
    setData(d);
  }

  async function freeze() {
    const res = await fetch(`/api/admin/reports/reconciliation/freeze?from=${from}&to=${to}`, {
      method: "POST",
      headers: { authorization: `Bearer ${token()}` },
    });
    const d = await res.json();
    setMsg(res.ok ? `บันทึก snapshot สำเร็จ (${d.snapshot?.period})` : (d.error ?? "error"));
  }

  const variance = data?.totals.variance ?? 0;
  const balanced = variance === 0;

  return (
    <main className="mx-auto max-w-3xl p-6 space-y-6">
      <h1 className="text-xl font-semibold">กระทบยอด (Reconciliation)</h1>
      <section className="flex items-end gap-2">
        <label className="text-sm">
          จาก
          <input type="date" className="w-full rounded border p-2 text-sm" value={from} onChange={(e) => setFrom(e.target.value)} />
        </label>
        <label className="text-sm">
          ถึง
          <input type="date" className="w-full rounded border p-2 text-sm" value={to} onChange={(e) => setTo(e.target.value)} />
        </label>
        <Button onClick={run}>คำนวณ</Button>
        <Button variant="outline" onClick={freeze}>
          Freeze snapshot
        </Button>
      </section>
      {msg && <p className="text-sm text-primary">{msg}</p>}
      {data && (
        <>
          <div
            className={`rounded p-3 text-sm font-medium ${balanced ? "bg-green-100 text-green-800" : "bg-red-100 text-red-800"}`}
          >
            {balanced ? "BALANCED: variance 0.00" : `UNEXPLAINED VARIANCE: ${variance.toFixed(2)}`}
          </div>
          <table className="w-full text-xs">
            <tbody>
              {Object.entries(data.totals).map(([k, v]) => (
                <tr key={k} className="border-b">
                  <td className="py-1">{k}</td>
                  <td className="py-1 text-right">{Number(v).toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b text-left">
                <th>orderNo</th>
                <th className="text-right">total</th>
                <th className="text-right">fee+vat</th>
                <th className="text-right">paidOut</th>
                <th className="text-right">refunded</th>
                <th className="text-right">rowVar</th>
              </tr>
            </thead>
            <tbody>
              {data.rows.map((r) => (
                <tr key={r.orderNo} className={r.rowVariance !== 0 ? "bg-red-50" : ""}>
                  <td>{r.orderNo}</td>
                  <td className="text-right">{r.totalAmount.toFixed(2)}</td>
                  <td className="text-right">{r.feeVat.toFixed(2)}</td>
                  <td className="text-right">{r.paidOut.toFixed(2)}</td>
                  <td className="text-right">{r.refunded.toFixed(2)}</td>
                  <td className="text-right">{r.rowVariance.toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </main>
  );
}
