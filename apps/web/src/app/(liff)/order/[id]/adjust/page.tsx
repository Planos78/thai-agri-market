"use client";
import { useState } from "react";
import { useParams } from "next/navigation";
import { Button } from "@/components/ui/button";

// Buyer proposes an item-grain qty adjustment (reduce/increase volume).
export default function Adjust() {
  const { id } = useParams<{ id: string }>();
  const [orderItemId, setOrderItemId] = useState("");
  const [kind, setKind] = useState<"REDUCE" | "INCREASE">("INCREASE");
  const [deltaQty, setDeltaQty] = useState(1);
  const [msg, setMsg] = useState("");

  async function propose() {
    const lineUserId = sessionStorage.getItem("lineUserId") ?? "";
    const res = await fetch(`/api/liff/order/${id}/adjustments`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ lineUserId, orderItemId, kind, deltaQty }),
    });
    const d = await res.json();
    setMsg(res.ok ? "ส่งคำขอปรับจำนวนแล้ว (รออนุมัติ)" : d.error ?? "error");
  }

  return (
    <main className="mx-auto max-w-md p-6 space-y-4">
      <h1 className="text-xl font-semibold">ปรับจำนวนสินค้า</h1>
      <input className="w-full rounded border p-2 text-sm" placeholder="order item id" value={orderItemId} onChange={(e) => setOrderItemId(e.target.value)} />
      <select className="w-full rounded border p-2 text-sm" value={kind} onChange={(e) => setKind(e.target.value as "REDUCE" | "INCREASE")}>
        <option value="INCREASE">เพิ่มจำนวน</option>
        <option value="REDUCE">ลดจำนวน</option>
      </select>
      <input type="number" min={1} className="w-full rounded border p-2 text-sm" value={deltaQty} onChange={(e) => setDeltaQty(Number(e.target.value))} />
      <Button onClick={propose} disabled={!orderItemId || deltaQty < 1}>ส่งคำขอ</Button>
      {msg && <p className="text-sm text-primary">{msg}</p>}
    </main>
  );
}
