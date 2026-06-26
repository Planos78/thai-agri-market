"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

interface OrderItem {
  fruitName: string;
  quantity: number;
  price: string;
}
interface OrderRow {
  orderNo: string;
  status: string;
  totalAmount: string;
  createdAt: string;
  items: OrderItem[];
}

// Order history for the verified caller only (server scopes to the caller's buyerId).
export default function Orders() {
  const router = useRouter();
  const [orders, setOrders] = useState<OrderRow[]>([]);
  const [msg, setMsg] = useState("");

  useEffect(() => {
    const lineUserId = sessionStorage.getItem("lineUserId");
    if (!lineUserId) {
      router.push("/welcome");
      return;
    }
    fetch(`/api/liff/orders?lineUserId=${encodeURIComponent(lineUserId)}`)
      .then((r) => r.json())
      .then((d) => {
        if (d.error) setMsg(d.error);
        else setOrders(d.orders ?? []);
      });
  }, [router]);

  return (
    <main className="mx-auto max-w-md p-6 space-y-4">
      <h1 className="text-xl font-semibold">ประวัติการสั่งซื้อ</h1>
      {msg && <p className="text-sm text-red-600">{msg}</p>}
      {!msg && orders.length === 0 && <p className="text-sm text-neutral-500">ยังไม่มีออเดอร์</p>}
      {orders.map((o) => (
        <div key={o.orderNo} className="rounded border p-3 space-y-1">
          <div className="flex justify-between">
            <span className="font-medium">{o.orderNo}</span>
            <span className="text-sm text-neutral-500">{o.status}</span>
          </div>
          <div className="text-sm text-neutral-500">
            {o.items.map((i) => `${i.fruitName} x${i.quantity}`).join(", ")}
          </div>
          <div className="text-sm">{o.totalAmount} บาท</div>
        </div>
      ))}
    </main>
  );
}
