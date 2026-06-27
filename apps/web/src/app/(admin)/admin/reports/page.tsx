"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";

// P7 reports console: pick a date window, fetch a report, view totals, download raw CSV.
// Thin UI — all aggregation is in the API routes (perm reports.read).
const REPORTS = [
  { key: "revenue", label: "รายได้ (Revenue)" },
  { key: "expense", label: "จ่ายออก (Payout)" },
  { key: "refunds", label: "คืนเงิน (Refunds)" },
  { key: "wht", label: "ภาษีหัก ณ ที่จ่าย (WHT)" },
] as const;

export default function AdminReports() {
  const router = useRouter();
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [orchardId, setOrchardId] = useState("");
  const [data, setData] = useState<unknown>(null);
  const [msg, setMsg] = useState("");

  function token(): string {
    const t = sessionStorage.getItem("adminToken");
    if (!t) router.push("/admin/login");
    return t ?? "";
  }

  function qs(): string {
    const p = new URLSearchParams({ from, to });
    if (orchardId) p.set("orchardId", orchardId);
    return p.toString();
  }

  async function run(key: string) {
    setMsg("");
    setData(null);
    const res = await fetch(`/api/admin/reports/${key}?${qs()}`, {
      headers: { authorization: `Bearer ${token()}` },
    });
    const d = await res.json();
    if (!res.ok) {
      setMsg(d.error ?? "error");
      return;
    }
    setData(d);
  }

  function downloadRaw() {
    window.open(`/api/admin/reports/raw?${qs()}&format=csv`, "_blank");
  }

  return (
    <main className="mx-auto max-w-2xl p-6 space-y-6">
      <h1 className="text-xl font-semibold">รายงานการเงิน</h1>
      <section className="grid grid-cols-3 gap-2">
        <label className="text-sm">
          จาก
          <input type="date" className="w-full rounded border p-2 text-sm" value={from} onChange={(e) => setFrom(e.target.value)} />
        </label>
        <label className="text-sm">
          ถึง
          <input type="date" className="w-full rounded border p-2 text-sm" value={to} onChange={(e) => setTo(e.target.value)} />
        </label>
        <label className="text-sm">
          orchardId
          <input className="w-full rounded border p-2 text-sm" placeholder="(ทั้งหมด)" value={orchardId} onChange={(e) => setOrchardId(e.target.value)} />
        </label>
      </section>
      <section className="flex flex-wrap gap-2">
        {REPORTS.map((r) => (
          <Button key={r.key} onClick={() => run(r.key)}>
            {r.label}
          </Button>
        ))}
        <Button variant="outline" onClick={downloadRaw}>
          ดาวน์โหลด Raw CSV
        </Button>
        <Button variant="outline" onClick={() => router.push("/admin/reports/reconciliation")}>
          กระทบยอด (Reconciliation)
        </Button>
      </section>
      {msg && <p className="text-sm text-primary">{msg}</p>}
      {data != null && (
        <pre className="overflow-auto rounded border bg-muted p-3 text-xs">{JSON.stringify(data, null, 2)}</pre>
      )}
    </main>
  );
}
