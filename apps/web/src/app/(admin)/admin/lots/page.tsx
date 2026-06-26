"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";

interface Lot {
  id: string;
  fruitName: string;
  price: string;
  quantity: number;
  status: string;
  qcStatus: string;
  orchard: { name: string; province: string };
}

export default function AdminLots() {
  const router = useRouter();
  const [lots, setLots] = useState<Lot[]>([]);
  const [msg, setMsg] = useState("");
  const [form, setForm] = useState({ orchardId: "", fruitName: "", price: "", quantity: "" });

  function token() {
    return sessionStorage.getItem("adminToken");
  }

  function load() {
    const t = token();
    if (!t) return void router.push("/admin/login");
    fetch("/api/admin/lots", { headers: { authorization: `Bearer ${t}` } })
      .then((r) => r.json().then((d) => ({ ok: r.ok, d })))
      .then(({ ok, d }) => (ok ? setLots(d.lots ?? []) : setMsg(d.error ?? "error")));
  }

  useEffect(load, [router]);

  async function create() {
    setMsg("");
    const res = await fetch("/api/admin/lots", {
      method: "POST",
      headers: { authorization: `Bearer ${token()}`, "content-type": "application/json" },
      body: JSON.stringify({
        orchardId: form.orchardId,
        fruitName: form.fruitName,
        price: Number(form.price),
        quantity: Number(form.quantity),
      }),
    });
    const d = await res.json();
    if (!res.ok) return setMsg(d.error ?? "error");
    setForm({ orchardId: "", fruitName: "", price: "", quantity: "" });
    load();
  }

  async function qc(lot: Lot, action: "RELEASE" | "HOLD" | "DOWNGRADE") {
    const res = await fetch(`/api/admin/lots/${lot.id}/qc`, {
      method: "POST",
      headers: { authorization: `Bearer ${token()}`, "content-type": "application/json" },
      body: JSON.stringify({ action }),
    });
    if (!res.ok) {
      const d = await res.json();
      return setMsg(d.error ?? "error");
    }
    load();
  }

  async function setStatus(lot: Lot, status: string) {
    setMsg("");
    const res = await fetch(`/api/admin/lots/${lot.id}`, {
      method: "PATCH",
      headers: { authorization: `Bearer ${token()}`, "content-type": "application/json" },
      body: JSON.stringify({ status }),
    });
    if (!res.ok) {
      const d = await res.json();
      return setMsg(d.error ?? "error");
    }
    load();
  }

  return (
    <main className="mx-auto max-w-4xl p-6 space-y-4">
      <nav className="flex gap-4 text-sm text-primary underline">
        <a href="/admin/orders">ออเดอร์</a>
        <a href="/admin/orchards">สวน</a>
        <a href="/admin/lots">ล็อต</a>
        <a href="/admin/buyers">ผู้ซื้อ</a>
      </nav>
      <h1 className="text-xl font-semibold">จัดการล็อต</h1>
      {msg && <p className="text-sm text-red-600">{msg}</p>}

      <div className="flex flex-wrap gap-2">
        <input className="rounded border px-3 py-2" placeholder="orchardId" value={form.orchardId} onChange={(e) => setForm({ ...form, orchardId: e.target.value })} />
        <input className="rounded border px-3 py-2" placeholder="ชื่อผลไม้" value={form.fruitName} onChange={(e) => setForm({ ...form, fruitName: e.target.value })} />
        <input className="rounded border px-3 py-2 w-24" placeholder="ราคา" value={form.price} onChange={(e) => setForm({ ...form, price: e.target.value })} />
        <input className="rounded border px-3 py-2 w-24" placeholder="จำนวน" value={form.quantity} onChange={(e) => setForm({ ...form, quantity: e.target.value })} />
        <Button onClick={create}>เพิ่มล็อต</Button>
      </div>

      <table className="w-full text-sm">
        <thead><tr className="text-left border-b"><th className="py-2">ผลไม้</th><th>สวน</th><th>ราคา</th><th>สถานะ</th><th>QC</th><th>การจัดการ QC</th></tr></thead>
        <tbody>
          {lots.map((l) => (
            <tr key={l.id} className="border-b">
              <td className="py-2">{l.fruitName}</td>
              <td>{l.orchard?.name ?? "-"}</td>
              <td>{l.price}</td>
              <td>
                <select
                  className="rounded border px-2 py-1 text-sm"
                  value={l.status}
                  onChange={(e) => setStatus(l, e.target.value)}
                >
                  <option value="DRAFT">DRAFT</option>
                  <option value="ACTIVE">ACTIVE</option>
                  <option value="SOLD_OUT">SOLD_OUT</option>
                  <option value="CANCELLED">CANCELLED</option>
                </select>
                {l.status !== "ACTIVE" && (
                  <Button size="sm" className="ml-1" onClick={() => setStatus(l, "ACTIVE")}>Activate</Button>
                )}
              </td>
              <td>{l.qcStatus}</td>
              <td className="flex gap-1 py-1">
                <Button size="sm" onClick={() => qc(l, "RELEASE")}>Release</Button>
                <Button size="sm" variant="outline" onClick={() => qc(l, "HOLD")}>Hold</Button>
                <Button size="sm" variant="destructive" onClick={() => qc(l, "DOWNGRADE")}>Downgrade</Button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </main>
  );
}
