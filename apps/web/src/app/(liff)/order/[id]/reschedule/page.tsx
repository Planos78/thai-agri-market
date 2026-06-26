"use client";
import { useState } from "react";
import { useParams } from "next/navigation";
import { Button } from "@/components/ui/button";

// Buyer proposes a new delivery date OR confirms/declines an orchard proposal.
export default function Reschedule() {
  const { id } = useParams<{ id: string }>();
  const [proposedDate, setProposedDate] = useState("");
  const [rid, setRid] = useState("");
  const [msg, setMsg] = useState("");

  const lineUserId = () => sessionStorage.getItem("lineUserId") ?? "";

  async function propose() {
    const res = await fetch(`/api/liff/order/${id}/reschedule`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ lineUserId: lineUserId(), proposedDate }),
    });
    const d = await res.json();
    setMsg(res.ok ? "ส่งคำขอเลื่อนวันแล้ว" : d.error ?? "error");
  }

  async function decide(decision: "APPROVE" | "REJECT") {
    if (!rid) return setMsg("ใส่รหัสคำขอ (rid) ก่อน");
    const res = await fetch(`/api/liff/order/${id}/reschedule/${rid}/decide`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ lineUserId: lineUserId(), decision, unfulfillable: decision === "REJECT" }),
    });
    const d = await res.json();
    setMsg(res.ok ? `บันทึก ${decision} แล้ว` : d.error ?? "error");
  }

  return (
    <main className="mx-auto max-w-md p-6 space-y-4">
      <h1 className="text-xl font-semibold">เลื่อนวันจัดส่ง</h1>
      <section className="space-y-2">
        <label className="block text-sm">ขอเลื่อนเป็นวันที่</label>
        <input type="date" className="w-full rounded border p-2 text-sm" value={proposedDate} onChange={(e) => setProposedDate(e.target.value)} />
        <Button onClick={propose} disabled={!proposedDate}>ส่งคำขอเลื่อนวัน</Button>
      </section>
      <section className="space-y-2 border-t pt-4">
        <label className="block text-sm">ยืนยัน/ปฏิเสธคำขอจากสวน (rid)</label>
        <input className="w-full rounded border p-2 text-sm" placeholder="reschedule id" value={rid} onChange={(e) => setRid(e.target.value)} />
        <div className="flex gap-2">
          <Button onClick={() => decide("APPROVE")}>ยืนยัน</Button>
          <Button variant="destructive" onClick={() => decide("REJECT")}>ปฏิเสธ</Button>
        </div>
      </section>
      {msg && <p className="text-sm text-primary">{msg}</p>}
    </main>
  );
}
