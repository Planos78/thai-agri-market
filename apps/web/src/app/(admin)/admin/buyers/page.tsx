"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

interface Buyer {
  id: string;
  lineUserId: string;
  phone: string;
  name: string | null;
  consent: boolean;
  latestConsent: { purpose: string; granted: boolean; createdAt: string } | null;
}

export default function AdminBuyers() {
  const router = useRouter();
  const [buyers, setBuyers] = useState<Buyer[]>([]);
  const [msg, setMsg] = useState("");

  useEffect(() => {
    const token = sessionStorage.getItem("adminToken");
    if (!token) return void router.push("/admin/login");
    fetch("/api/admin/buyers", { headers: { authorization: `Bearer ${token}` } })
      .then((r) => r.json().then((d) => ({ ok: r.ok, d })))
      .then(({ ok, d }) => (ok ? setBuyers(d.buyers ?? []) : setMsg(d.error ?? "error")));
  }, [router]);

  return (
    <main className="mx-auto max-w-3xl p-6 space-y-4">
      <nav className="flex gap-4 text-sm text-primary underline">
        <a href="/admin/orders">ออเดอร์</a>
        <a href="/admin/orchards">สวน</a>
        <a href="/admin/lots">ล็อต</a>
        <a href="/admin/buyers">ผู้ซื้อ</a>
      </nav>
      <h1 className="text-xl font-semibold">ผู้ซื้อที่ยืนยันแล้ว</h1>
      {msg && <p className="text-sm text-red-600">{msg}</p>}
      <table className="w-full text-sm">
        <thead><tr className="text-left border-b"><th className="py-2">ชื่อ</th><th>เบอร์</th><th>LINE</th><th>ยินยอม</th></tr></thead>
        <tbody>
          {buyers.map((b) => (
            <tr key={b.id} className="border-b">
              <td className="py-2">{b.name ?? "-"}</td>
              <td>{b.phone}</td>
              <td>{b.lineUserId}</td>
              <td>{b.latestConsent ? (b.latestConsent.granted ? "✓" : "✗") : b.consent ? "✓" : "-"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </main>
  );
}
