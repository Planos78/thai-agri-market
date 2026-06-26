"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

interface Order {
  id: string;
  orderNo: string;
  status: string;
  totalAmount: string;
  buyer: { lineUserId: string | null; name: string | null };
  payment: { status: string; escrowStatus: string } | null;
}

export default function AdminOrders() {
  const router = useRouter();
  const [orders, setOrders] = useState<Order[]>([]);
  const [msg, setMsg] = useState("");

  useEffect(() => {
    const token = sessionStorage.getItem("adminToken");
    if (!token) return void router.push("/login");
    fetch("/api/admin/orders", { headers: { authorization: `Bearer ${token}` } })
      .then((r) => r.json().then((d) => ({ ok: r.ok, d })))
      .then(({ ok, d }) => (ok ? setOrders(d.orders ?? []) : setMsg(d.error ?? "error")));
  }, [router]);

  return (
    <main className="mx-auto max-w-3xl p-6 space-y-4">
      <h1 className="text-xl font-semibold">ออเดอร์ทั้งหมด</h1>
      {msg && <p className="text-sm text-red-600">{msg}</p>}
      <table className="w-full text-sm">
        <thead><tr className="text-left border-b"><th className="py-2">Order</th><th>สถานะ</th><th>ยอด</th><th>Payment</th><th>Escrow</th></tr></thead>
        <tbody>
          {orders.map((o) => (
            <tr key={o.id} className="border-b">
              <td className="py-2">{o.orderNo}</td>
              <td>{o.status}</td>
              <td>{o.totalAmount}</td>
              <td>{o.payment?.status ?? "-"}</td>
              <td>{o.payment?.escrowStatus ?? "-"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </main>
  );
}
