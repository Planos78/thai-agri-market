"use client";
import { useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";

// Ops/CX: create delivery, upload proof image(s), mark delivered.
export default function AdminDelivery() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [trackingNo, setTrackingNo] = useState("");
  const [carrier, setCarrier] = useState("");
  const [files, setFiles] = useState<FileList | null>(null);
  const [msg, setMsg] = useState("");

  function token(): string {
    const t = sessionStorage.getItem("adminToken");
    if (!t) router.push("/admin/login");
    return t ?? "";
  }

  async function createDelivery() {
    const res = await fetch(`/api/admin/orders/${id}/delivery`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token()}` },
      body: JSON.stringify({ trackingNo, carrier }),
    });
    const d = await res.json();
    setMsg(res.ok ? "สร้าง delivery แล้ว (PREPARING)" : d.error ?? "error");
  }

  async function uploadProof() {
    if (!files || files.length === 0) return setMsg("เลือกรูปก่อน");
    const form = new FormData();
    Array.from(files).forEach((f) => form.append("file", f));
    const res = await fetch(`/api/admin/orders/${id}/delivery/proof`, {
      method: "POST",
      headers: { authorization: `Bearer ${token()}` },
      body: form,
    });
    const d = await res.json();
    setMsg(res.ok ? `อัปโหลด ${d.images?.length ?? 0} รูปแล้ว (IN_TRANSIT)` : d.error ?? "error");
  }

  async function deliver() {
    const res = await fetch(`/api/admin/orders/${id}/delivery/deliver`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token()}` },
      body: JSON.stringify({}),
    });
    const d = await res.json();
    setMsg(res.ok ? "ทำเครื่องหมายจัดส่งสำเร็จ (DELIVERED)" : d.error ?? "error");
  }

  return (
    <main className="mx-auto max-w-md p-6 space-y-6">
      <h1 className="text-xl font-semibold">จัดส่งออเดอร์ {id}</h1>
      <section className="space-y-2">
        <h2 className="text-sm font-medium">1. สร้าง/แก้ไข delivery</h2>
        <input className="w-full rounded border p-2 text-sm" placeholder="tracking no" value={trackingNo} onChange={(e) => setTrackingNo(e.target.value)} />
        <input className="w-full rounded border p-2 text-sm" placeholder="carrier" value={carrier} onChange={(e) => setCarrier(e.target.value)} />
        <Button onClick={createDelivery}>บันทึก delivery</Button>
      </section>
      <section className="space-y-2 border-t pt-4">
        <h2 className="text-sm font-medium">2. อัปโหลดหลักฐานการจัดส่ง</h2>
        <input type="file" accept="image/*" multiple onChange={(e) => setFiles(e.target.files)} className="text-sm" />
        <Button onClick={uploadProof}>อัปโหลดรูป</Button>
      </section>
      <section className="space-y-2 border-t pt-4">
        <h2 className="text-sm font-medium">3. ทำเครื่องหมายจัดส่งสำเร็จ</h2>
        <Button onClick={deliver}>จัดส่งสำเร็จ</Button>
      </section>
      {msg && <p className="text-sm text-primary">{msg}</p>}
    </main>
  );
}
