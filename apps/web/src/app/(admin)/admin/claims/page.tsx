"use client";
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";

interface ClaimRow {
  id: string;
  claimNo: string;
  orderId: string;
  category: string;
  severity: string;
  status: string;
  createdAt: string;
}

// Ops claims queue: filter by status, jump to a claim's triage page.
export default function AdminClaims() {
  const router = useRouter();
  const [rows, setRows] = useState<ClaimRow[]>([]);
  const [status, setStatus] = useState("");
  const [msg, setMsg] = useState("");

  const token = useCallback((): string => {
    const t = sessionStorage.getItem("adminToken");
    if (!t) router.push("/admin/login");
    return t ?? "";
  }, [router]);

  const load = useCallback(async () => {
    const qs = status ? `?status=${status}` : "";
    const res = await fetch(`/api/admin/claims${qs}`, { headers: { authorization: `Bearer ${token()}` } });
    const d = await res.json();
    if (!res.ok) return setMsg(d.error ?? "error");
    setRows(d.claims);
  }, [status, token]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <main className="mx-auto max-w-2xl p-6 space-y-4">
      <h1 className="text-xl font-semibold">เคลม / Claims</h1>
      <select className="rounded border p-2 text-sm" value={status} onChange={(e) => setStatus(e.target.value)}>
        <option value="">ทั้งหมด</option>
        <option value="OPEN">OPEN</option>
        <option value="TRIAGING">TRIAGING</option>
        <option value="ESCALATED">ESCALATED</option>
        <option value="RESOLVED">RESOLVED</option>
        <option value="REJECTED">REJECTED</option>
      </select>
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-muted-foreground">
            <th className="py-1">claimNo</th><th>category</th><th>severity</th><th>status</th><th></th>
          </tr>
        </thead>
        <tbody>
          {rows.map((c) => (
            <tr key={c.id} className="border-t">
              <td className="py-1">{c.claimNo}</td>
              <td>{c.category}</td>
              <td>{c.severity}</td>
              <td>{c.status}</td>
              <td><a className="text-primary underline" href={`/admin/claims/${c.id}`}>เปิด</a></td>
            </tr>
          ))}
        </tbody>
      </table>
      {msg && <p className="text-sm text-primary">{msg}</p>}
    </main>
  );
}
