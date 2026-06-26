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
  orchard: { name: string; province: string };
}

export default function Lots() {
  const router = useRouter();
  const [lots, setLots] = useState<Lot[]>([]);
  const [qty, setQty] = useState<Record<string, number>>({});

  useEffect(() => {
    fetch("/api/liff/lots").then((r) => r.json()).then((d) => setLots(d.lots ?? []));
  }, []);

  function order(lot: Lot) {
    const q = qty[lot.id] ?? 1;
    sessionStorage.setItem("cart", JSON.stringify([{ lotId: lot.id, quantity: q, fruitName: lot.fruitName, price: lot.price }]));
    router.push("/order/confirm");
  }

  return (
    <main className="mx-auto max-w-md p-6 space-y-4">
      <h1 className="text-xl font-semibold">ผลไม้ตามฤดู</h1>
      {lots.length === 0 && <p className="text-sm text-neutral-500">ยังไม่มี lot</p>}
      {lots.map((lot) => (
        <div key={lot.id} className="rounded border p-3 space-y-2">
          <div className="font-medium">{lot.fruitName} {lot.variety ?? ""} {lot.grade ? `(${lot.grade})` : ""}</div>
          <div className="text-sm text-neutral-500">{lot.orchard.name} · {lot.orchard.province}</div>
          <div className="text-sm">{lot.price} บาท/{lot.unit}</div>
          <div className="flex items-center gap-2">
            <input
              type="number" min={1} className="w-20 rounded border px-2 py-1"
              value={qty[lot.id] ?? 1}
              onChange={(e) => setQty({ ...qty, [lot.id]: Number(e.target.value) })}
            />
            <Button onClick={() => order(lot)}>สั่งซื้อ</Button>
          </div>
        </div>
      ))}
    </main>
  );
}
