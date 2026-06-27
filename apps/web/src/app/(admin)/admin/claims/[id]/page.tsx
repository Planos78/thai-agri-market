"use client";
import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";

interface Event {
  id: string;
  action: string;
  fromStatus: string | null;
  toStatus: string;
  actor: string;
  note: string | null;
  createdAt: string;
}
interface Claim {
  id: string;
  claimNo: string;
  orderId: string;
  category: string;
  severity: string;
  status: string;
  description: string;
  aiFlag: string | null;
}

// Ops claim triage: classify (suggestion-only), pick up (TRIAGE), resolve/reject/escalate,
// optionally create a linked refund on RESOLVED.
export default function AdminClaimDetail() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [claim, setClaim] = useState<Claim | null>(null);
  const [events, setEvents] = useState<Event[]>([]);
  const [severity, setSeverity] = useState("LOW");
  const [aiFlag, setAiFlag] = useState("");
  const [note, setNote] = useState("");
  const [createRefund, setCreateRefund] = useState(false);
  const [refundKind, setRefundKind] = useState<"FULL" | "PARTIAL">("PARTIAL");
  const [refundAmount, setRefundAmount] = useState("");
  const [msg, setMsg] = useState("");

  const token = useCallback((): string => {
    const t = sessionStorage.getItem("adminToken");
    if (!t) router.push("/admin/login");
    return t ?? "";
  }, [router]);

  const load = useCallback(async () => {
    const res = await fetch(`/api/admin/claims/${id}`, { headers: { authorization: `Bearer ${token()}` } });
    const d = await res.json();
    if (!res.ok) return setMsg(d.error ?? "error");
    setClaim(d.claim);
    setEvents(d.events);
  }, [id, token]);

  useEffect(() => {
    void load();
  }, [load]);

  async function triage(action: "TRIAGE" | "CLASSIFY") {
    const res = await fetch(`/api/admin/claims/${id}/triage`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token()}` },
      body: JSON.stringify({ action, severity, aiFlag: aiFlag || undefined, note: note || undefined }),
    });
    const d = await res.json();
    if (!res.ok) return setMsg(d.error ?? "error");
    setMsg(`${action} OK`);
    void load();
  }

  async function resolve(decision: "RESOLVED" | "REJECTED" | "ESCALATED") {
    const res = await fetch(`/api/admin/claims/${id}/resolve`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token()}` },
      body: JSON.stringify({
        decision,
        note: note || undefined,
        createRefund: decision === "RESOLVED" ? createRefund : false,
        refundKind,
        refundAmount: refundAmount ? Number(refundAmount) : undefined,
      }),
    });
    const d = await res.json();
    if (!res.ok) return setMsg(d.error ?? "error");
    setMsg(`${decision} OK${d.refund ? ` · refund ${d.refund.refundNo}` : ""}`);
    void load();
  }

  return (
    <main className="mx-auto max-w-md p-6 space-y-6">
      <nav className="text-sm text-primary underline"><a href="/admin/claims">← เคลม</a></nav>
      {claim && (
        <div className="space-y-1">
          <h1 className="text-xl font-semibold">{claim.claimNo}</h1>
          <p className="text-sm">สถานะ <b>{claim.status}</b> · {claim.category} · order {claim.orderId}</p>
          <p className="text-sm text-muted-foreground">{claim.description}</p>
          {claim.aiFlag && <p className="text-sm text-destructive">AI flag: {claim.aiFlag}</p>}
        </div>
      )}

      <section className="space-y-2 border-t pt-4">
        <h2 className="text-sm font-medium">จัดประเภท / รับเรื่อง</h2>
        <select className="w-full rounded border p-2 text-sm" value={severity} onChange={(e) => setSeverity(e.target.value)}>
          <option value="LOW">LOW</option><option value="MEDIUM">MEDIUM</option><option value="HIGH">HIGH</option>
        </select>
        <input className="w-full rounded border p-2 text-sm" placeholder="ai flag (suggestion)" value={aiFlag} onChange={(e) => setAiFlag(e.target.value)} />
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => triage("CLASSIFY")}>บันทึกการจัดประเภท</Button>
          <Button onClick={() => triage("TRIAGE")}>รับเรื่อง (TRIAGING)</Button>
        </div>
      </section>

      <section className="space-y-2 border-t pt-4">
        <h2 className="text-sm font-medium">ตัดสิน</h2>
        <input className="w-full rounded border p-2 text-sm" placeholder="หมายเหตุ" value={note} onChange={(e) => setNote(e.target.value)} />
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={createRefund} onChange={(e) => setCreateRefund(e.target.checked)} />
          สร้างคืนเงิน (เมื่อ RESOLVED)
        </label>
        {createRefund && (
          <div className="flex gap-2">
            <select className="rounded border p-2 text-sm" value={refundKind} onChange={(e) => setRefundKind(e.target.value as "FULL" | "PARTIAL")}>
              <option value="PARTIAL">PARTIAL</option><option value="FULL">FULL</option>
            </select>
            {refundKind === "PARTIAL" && (
              <input type="number" min={0} className="w-28 rounded border p-2 text-sm" placeholder="amount" value={refundAmount} onChange={(e) => setRefundAmount(e.target.value)} />
            )}
          </div>
        )}
        <div className="flex gap-2">
          <Button onClick={() => resolve("RESOLVED")}>RESOLVED</Button>
          <Button variant="destructive" onClick={() => resolve("REJECTED")}>REJECTED</Button>
          <Button variant="outline" onClick={() => resolve("ESCALATED")}>ESCALATED</Button>
        </div>
      </section>

      <section className="space-y-1 border-t pt-4">
        <h2 className="text-sm font-medium">ประวัติ (audit)</h2>
        {events.map((e) => (
          <p key={e.id} className="text-xs text-muted-foreground">
            {e.action}: {e.fromStatus ?? "—"} → {e.toStatus} · {e.actor}{e.note ? ` · ${e.note}` : ""}
          </p>
        ))}
      </section>
      {msg && <p className="text-sm text-primary">{msg}</p>}
    </main>
  );
}
