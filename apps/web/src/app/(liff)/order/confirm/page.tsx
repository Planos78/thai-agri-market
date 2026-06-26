"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";

interface CartLine { lotId: string; quantity: number; fruitName: string; price: string }

export default function Confirm() {
  const router = useRouter();
  const [cart, setCart] = useState<CartLine[]>([]);
  const [address, setAddress] = useState("");
  const [msg, setMsg] = useState("");

  useEffect(() => {
    const c = sessionStorage.getItem("cart");
    if (c) setCart(JSON.parse(c));
  }, []);

  async function submit() {
    setMsg("");
    const lineUserId = sessionStorage.getItem("lineUserId");
    const res = await fetch("/api/liff/order", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ lineUserId, items: cart.map((c) => ({ lotId: c.lotId, quantity: c.quantity })), shippingAddress: address }),
    });
    const d = await res.json();
    if (!res.ok) return setMsg(d.error ?? "error");
    router.push(`/order/${d.order.id}/pay`);
  }

  return (
    <main className="mx-auto max-w-md p-6 space-y-4">
      <h1 className="text-xl font-semibold">ยืนยันออเดอร์</h1>
      {cart.map((c) => (
        <div key={c.lotId} className="rounded border p-3 text-sm">
          {c.fruitName} x {c.quantity} @ {c.price}
        </div>
      ))}
      <textarea className="w-full rounded border px-3 py-2" value={address} onChange={(e) => setAddress(e.target.value)} placeholder="ที่อยู่จัดส่ง" />
      <Button onClick={submit}>สร้างออเดอร์</Button>
      {msg && <p className="text-sm text-red-600">{msg}</p>}
    </main>
  );
}
