"use client";
import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";

interface Item {
  id: string;
  orderItemId: string;
  expectedQty: number;
  packedQty: number;
}
interface Manifest {
  id: string;
  status: string;
  expectedCount: number;
  packedCount: number;
  hasVariance: boolean;
  note: string | null;
}

// Ops manifest reconcile: enter packedQty per item, upload evidence, human sign-off.
export default function AdminPackingDetail() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [manifest, setManifest] = useState<Manifest | null>(null);
  const [items, setItems] = useState<Item[]>([]);
  const [note, setNote] = useState("");
  const [files, setFiles] = useState<FileList | null>(null);
  const [msg, setMsg] = useState("");

  const token = useCallback((): string => {
    const t = sessionStorage.getItem("adminToken");
    if (!t) router.push("/admin/login");
    return t ?? "";
  }, [router]);

  const load = useCallback(async () => {
    const res = await fetch(`/api/admin/packing/${id}`, { headers: { authorization: `Bearer ${token()}` } });
    const d = await res.json();
    if (!res.ok) return setMsg(d.error ?? "error");
    setManifest(d.manifest);
    setItems(d.items);
  }, [id, token]);

  useEffect(() => {
    void load();
  }, [load]);

  async function saveQtys() {
    const res = await fetch(`/api/admin/packing/${id}/items`, {
      method: "PATCH",
      headers: { "content-type": "application/json", authorization: `Bearer ${token()}` },
      body: JSON.stringify({ items: items.map((it) => ({ orderItemId: it.orderItemId, packedQty: it.packedQty })) }),
    });
    const d = await res.json();
    if (!res.ok) return setMsg(d.error ?? "error");
    setManifest(d.manifest);
    setMsg(`สถานะ: ${d.manifest.status}${d.manifest.hasVariance ? " (มีส่วนต่าง)" : ""}`);
  }

  async function uploadImages() {
    if (!files || files.length === 0) return setMsg("เลือกรูปก่อน");
    const form = new FormData();
    Array.from(files).forEach((f) => form.append("file", f));
    const res = await fetch(`/api/admin/packing/${id}/images`, {
      method: "POST",
      headers: { authorization: `Bearer ${token()}` },
      body: form,
    });
    const d = await res.json();
    setMsg(res.ok ? `อัปโหลด ${d.images?.length ?? 0} รูปแล้ว` : d.error ?? "error");
  }

  async function signoff() {
    const res = await fetch(`/api/admin/packing/${id}/signoff`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token()}` },
      body: JSON.stringify({ note }),
    });
    const d = await res.json();
    if (!res.ok) return setMsg(d.error ?? "error");
    setManifest(d.manifest);
    setMsg(`เซ็นรับรองแล้ว: ${d.manifest.status}`);
  }

  return (
    <main className="mx-auto max-w-md p-6 space-y-6">
      <nav className="text-sm text-primary underline"><a href="/admin/packing">← แพ็กกิ้ง</a></nav>
      <h1 className="text-xl font-semibold">ใบจัดของ {id}</h1>
      {manifest && (
        <p className="text-sm">
          สถานะ <b>{manifest.status}</b> · คาดหวัง {manifest.expectedCount} · แพ็กแล้ว {manifest.packedCount}
          {manifest.hasVariance && <span className="text-destructive"> · มีส่วนต่าง</span>}
        </p>
      )}

      <section className="space-y-2 border-t pt-4">
        <h2 className="text-sm font-medium">นับ/บันทึกจำนวนที่แพ็ก</h2>
        {items.map((it, idx) => (
          <div key={it.id} className="flex items-center gap-2 text-sm">
            <span className="flex-1 truncate">{it.orderItemId}</span>
            <span className="text-muted-foreground">คาดหวัง {it.expectedQty}</span>
            <input
              type="number"
              min={0}
              className="w-20 rounded border p-1"
              value={it.packedQty}
              onChange={(e) => {
                const v = Number(e.target.value);
                setItems((prev) => prev.map((p, i) => (i === idx ? { ...p, packedQty: v } : p)));
              }}
            />
          </div>
        ))}
        <Button onClick={saveQtys} disabled={manifest?.status === "SIGNED_OFF"}>บันทึก + ตรวจสอบส่วนต่าง</Button>
      </section>

      <section className="space-y-2 border-t pt-4">
        <h2 className="text-sm font-medium">อัปโหลดรูปหลักฐาน</h2>
        <input type="file" accept="image/*" multiple onChange={(e) => setFiles(e.target.files)} className="text-sm" />
        <Button onClick={uploadImages}>อัปโหลด</Button>
      </section>

      <section className="space-y-2 border-t pt-4">
        <h2 className="text-sm font-medium">เซ็นรับรอง (ต้องมีหมายเหตุถ้ามีส่วนต่าง)</h2>
        <input className="w-full rounded border p-2 text-sm" placeholder="หมายเหตุ (จำเป็นถ้ามีส่วนต่าง)" value={note} onChange={(e) => setNote(e.target.value)} />
        <Button onClick={signoff} disabled={manifest?.status === "OPEN" || manifest?.status === "SIGNED_OFF"}>เซ็นรับรอง</Button>
      </section>
      {msg && <p className="text-sm text-primary">{msg}</p>}
    </main>
  );
}
