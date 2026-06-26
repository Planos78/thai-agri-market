"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";

interface Orchard {
  id: string;
  name: string;
  province: string;
  ownerId: string;
  isVerified: boolean;
}

export default function AdminOrchards() {
  const router = useRouter();
  const [orchards, setOrchards] = useState<Orchard[]>([]);
  const [msg, setMsg] = useState("");
  const [form, setForm] = useState({ name: "", province: "", ownerId: "" });

  function token() {
    return sessionStorage.getItem("adminToken");
  }

  function load() {
    const t = token();
    if (!t) return void router.push("/admin/login");
    fetch("/api/admin/orchards", { headers: { authorization: `Bearer ${t}` } })
      .then((r) => r.json().then((d) => ({ ok: r.ok, d })))
      .then(({ ok, d }) => (ok ? setOrchards(d.orchards ?? []) : setMsg(d.error ?? "error")));
  }

  useEffect(load, [router]);

  async function create() {
    setMsg("");
    const res = await fetch("/api/admin/orchards", {
      method: "POST",
      headers: { authorization: `Bearer ${token()}`, "content-type": "application/json" },
      body: JSON.stringify(form),
    });
    const d = await res.json();
    if (!res.ok) return setMsg(d.error ?? "error");
    setForm({ name: "", province: "", ownerId: "" });
    load();
  }

  async function toggleVerify(o: Orchard) {
    const res = await fetch(`/api/admin/orchards/${o.id}`, {
      method: "PATCH",
      headers: { authorization: `Bearer ${token()}`, "content-type": "application/json" },
      body: JSON.stringify({ isVerified: !o.isVerified }),
    });
    if (!res.ok) {
      const d = await res.json();
      return setMsg(d.error ?? "error");
    }
    load();
  }

  return (
    <main className="mx-auto max-w-3xl p-6 space-y-4">
      <nav className="flex gap-4 text-sm text-primary underline">
        <a href="/admin/orders">ออเดอร์</a>
        <a href="/admin/orchards">สวน</a>
        <a href="/admin/lots">ล็อต</a>
        <a href="/admin/buyers">ผู้ซื้อ</a>
      </nav>
      <h1 className="text-xl font-semibold">จัดการสวน</h1>
      {msg && <p className="text-sm text-red-600">{msg}</p>}

      <div className="flex flex-wrap gap-2">
        <input className="rounded border px-3 py-2" placeholder="ชื่อสวน" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        <input className="rounded border px-3 py-2" placeholder="จังหวัด" value={form.province} onChange={(e) => setForm({ ...form, province: e.target.value })} />
        <input className="rounded border px-3 py-2" placeholder="ownerId" value={form.ownerId} onChange={(e) => setForm({ ...form, ownerId: e.target.value })} />
        <Button onClick={create}>เพิ่มสวน</Button>
      </div>

      <table className="w-full text-sm">
        <thead><tr className="text-left border-b"><th className="py-2">ชื่อ</th><th>จังหวัด</th><th>ยืนยัน</th><th></th></tr></thead>
        <tbody>
          {orchards.map((o) => (
            <tr key={o.id} className="border-b">
              <td className="py-2">{o.name}</td>
              <td>{o.province}</td>
              <td>{o.isVerified ? "✓" : "-"}</td>
              <td><Button size="sm" variant="outline" onClick={() => toggleVerify(o)}>{o.isVerified ? "ยกเลิกยืนยัน" : "ยืนยัน"}</Button></td>
            </tr>
          ))}
        </tbody>
      </table>
    </main>
  );
}
