"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";

// Ops packing console: create a manifest for an order, then jump to its reconcile page.
export default function AdminPacking() {
  const router = useRouter();
  const [orderId, setOrderId] = useState("");
  const [msg, setMsg] = useState("");

  function token(): string {
    const t = sessionStorage.getItem("adminToken");
    if (!t) router.push("/admin/login");
    return t ?? "";
  }

  async function createManifest() {
    const res = await fetch(`/api/admin/orders/${orderId}/packing`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token()}` },
      body: JSON.stringify({}),
    });
    const d = await res.json();
    if (res.ok && d.manifest?.id) {
      router.push(`/admin/packing/${d.manifest.id}`);
      return;
    }
    setMsg(d.error ?? "error");
  }

  return (
    <main className="mx-auto max-w-md p-6 space-y-6">
      <h1 className="text-xl font-semibold">แพ็กกิ้ง / ใบจัดของ</h1>
      <section className="space-y-2">
        <h2 className="text-sm font-medium">สร้างใบจัดของจากออเดอร์</h2>
        <input className="w-full rounded border p-2 text-sm" placeholder="order id" value={orderId} onChange={(e) => setOrderId(e.target.value)} />
        <Button onClick={createManifest}>สร้างใบจัดของ</Button>
      </section>
      {msg && <p className="text-sm text-primary">{msg}</p>}
    </main>
  );
}
