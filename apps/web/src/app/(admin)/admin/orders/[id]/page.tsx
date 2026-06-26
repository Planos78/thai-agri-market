"use client";
import { useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";

// Ops detail panel: decide reschedule, propose/decide/cancel adjustment.
export default function AdminOrderDetail() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [rid, setRid] = useState("");
  const [aid, setAid] = useState("");
  const [orderItemId, setOrderItemId] = useState("");
  const [kind, setKind] = useState<"REDUCE" | "INCREASE">("REDUCE");
  const [deltaQty, setDeltaQty] = useState(1);
  const [msg, setMsg] = useState("");

  function auth() {
    const t = sessionStorage.getItem("adminToken");
    if (!t) router.push("/admin/login");
    return { "content-type": "application/json", authorization: `Bearer ${t ?? ""}` };
  }
  async function call(url: string, body: unknown) {
    const res = await fetch(url, { method: "POST", headers: auth(), body: JSON.stringify(body) });
    const d = await res.json();
    setMsg(res.ok ? "OK" : d.error ?? "error");
  }

  return (
    <main className="mx-auto max-w-md p-6 space-y-6">
      <nav className="text-sm text-primary underline"><a href="/admin/orders">← ออเดอร์</a></nav>
      <h1 className="text-xl font-semibold">จัดการออเดอร์ {id}</h1>
      <a className="text-sm text-primary underline" href={`/admin/orders/${id}/delivery`}>ไปหน้าจัดส่ง →</a>

      <section className="space-y-2 border-t pt-4">
        <h2 className="text-sm font-medium">ตัดสินคำขอเลื่อนวัน (rid)</h2>
        <input className="w-full rounded border p-2 text-sm" placeholder="reschedule id" value={rid} onChange={(e) => setRid(e.target.value)} />
        <div className="flex gap-2">
          <Button onClick={() => call(`/api/admin/orders/${id}/reschedule/${rid}/decide`, { decision: "APPROVE" })}>อนุมัติ</Button>
          <Button variant="destructive" onClick={() => call(`/api/admin/orders/${id}/reschedule/${rid}/decide`, { decision: "REJECT", unfulfillable: true })}>ปฏิเสธ</Button>
        </div>
      </section>

      <section className="space-y-2 border-t pt-4">
        <h2 className="text-sm font-medium">เสนอปรับจำนวน (item-grain)</h2>
        <input className="w-full rounded border p-2 text-sm" placeholder="order item id" value={orderItemId} onChange={(e) => setOrderItemId(e.target.value)} />
        <select className="w-full rounded border p-2 text-sm" value={kind} onChange={(e) => setKind(e.target.value as "REDUCE" | "INCREASE")}>
          <option value="REDUCE">ลดจำนวน (refund intent)</option>
          <option value="INCREASE">เพิ่มจำนวน (จ่ายเพิ่ม)</option>
        </select>
        <input type="number" min={1} className="w-full rounded border p-2 text-sm" value={deltaQty} onChange={(e) => setDeltaQty(Number(e.target.value))} />
        <Button onClick={() => call(`/api/admin/orders/${id}/adjustments`, { orderItemId, kind, deltaQty })}>เสนอ</Button>
      </section>

      <section className="space-y-2 border-t pt-4">
        <h2 className="text-sm font-medium">ตัดสิน/ยกเลิกการปรับจำนวน (aid)</h2>
        <input className="w-full rounded border p-2 text-sm" placeholder="adjustment id" value={aid} onChange={(e) => setAid(e.target.value)} />
        <div className="flex gap-2">
          <Button onClick={() => call(`/api/admin/orders/${id}/adjustments/${aid}/decide`, { decision: "APPROVE" })}>อนุมัติ</Button>
          <Button variant="destructive" onClick={() => call(`/api/admin/orders/${id}/adjustments/${aid}/decide`, { decision: "REJECT" })}>ปฏิเสธ</Button>
          <Button variant="outline" onClick={() => call(`/api/admin/orders/${id}/adjustments/${aid}/cancel`, {})}>ยกเลิก</Button>
        </div>
      </section>
      {msg && <p className="text-sm text-primary">{msg}</p>}
    </main>
  );
}
