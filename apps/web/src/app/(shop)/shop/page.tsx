"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";

interface Lot {
  id: string;
  fruitName: string;
  variety: string | null;
  grade: string | null;
  price: string;
  unit: string;
  minOrderQty: number | null;
  orchard: { name: string; province: string };
}

export default function ShopBrowse() {
  const router = useRouter();
  const [lots, setLots] = useState<Lot[]>([]);
  const [qty, setQty] = useState<Record<string, number>>({});

  useEffect(() => {
    fetch("/api/shop/lots")
      .then((r) => r.json())
      .then((d) => setLots(d.lots ?? []));
  }, []);

  function addToCart(lot: Lot) {
    const q = qty[lot.id] ?? lot.minOrderQty ?? 1;
    const cart = JSON.parse(sessionStorage.getItem("shopCart") ?? "[]") as { lotId: string; quantity: number }[];
    const existing = cart.find((c) => c.lotId === lot.id);
    if (existing) existing.quantity = q;
    else cart.push({ lotId: lot.id, quantity: q });
    sessionStorage.setItem("shopCart", JSON.stringify(cart));
    router.push("/shop/cart");
  }

  return (
    <main className="mx-auto max-w-3xl p-6 space-y-4">
      <h1 className="text-xl font-semibold">เลือกผลไม้</h1>
      <ul className="space-y-3">
        {lots.map((lot) => (
          <li key={lot.id} className="rounded border bg-white p-4">
            <div className="font-medium">
              {lot.fruitName} {lot.variety ?? ""} {lot.grade ? `(เกรด ${lot.grade})` : ""}
            </div>
            <div className="text-sm text-neutral-500">
              {lot.orchard.name} · {lot.orchard.province} · {Number(lot.price)} บาท/{lot.unit}
              {lot.minOrderQty ? ` · ขั้นต่ำ ${lot.minOrderQty}` : ""}
            </div>
            <div className="mt-2 flex items-center gap-2">
              <input
                type="number"
                min={lot.minOrderQty ?? 1}
                className="w-24 rounded border px-2 py-1"
                value={qty[lot.id] ?? lot.minOrderQty ?? 1}
                onChange={(e) => setQty({ ...qty, [lot.id]: Number(e.target.value) })}
              />
              <Button onClick={() => addToCart(lot)}>ใส่ตะกร้า</Button>
            </div>
          </li>
        ))}
      </ul>
    </main>
  );
}
