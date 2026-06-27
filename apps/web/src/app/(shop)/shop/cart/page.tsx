"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";

interface CartLine {
  lotId: string;
  quantity: number;
}

export default function ShopCart() {
  const router = useRouter();
  const [cart, setCart] = useState<CartLine[]>([]);
  const [address, setAddress] = useState("");

  useEffect(() => {
    setCart(JSON.parse(sessionStorage.getItem("shopCart") ?? "[]"));
  }, []);

  function confirm() {
    if (cart.length === 0 || !address) return;
    sessionStorage.setItem("shopAddress", address);
    router.push("/shop/verify");
  }

  return (
    <main className="mx-auto max-w-md p-6 space-y-4">
      <h1 className="text-xl font-semibold">ยืนยันคำสั่งซื้อ</h1>
      <ul className="space-y-2 text-sm">
        {cart.map((c) => (
          <li key={c.lotId} className="rounded border bg-white p-3">
            lot {c.lotId.slice(0, 8)} · จำนวน {c.quantity}
          </li>
        ))}
      </ul>
      <textarea
        className="w-full rounded border px-3 py-2"
        placeholder="ที่อยู่จัดส่ง"
        value={address}
        onChange={(e) => setAddress(e.target.value)}
      />
      <Button onClick={confirm} disabled={cart.length === 0 || !address}>
        ดำเนินการต่อ (ยืนยันเบอร์โทร)
      </Button>
    </main>
  );
}
