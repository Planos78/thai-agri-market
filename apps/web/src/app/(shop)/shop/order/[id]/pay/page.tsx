"use client";
import { use, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";

// Next 16: route params are a Promise; unwrap with React.use().
export default function ShopPay({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const [info, setInfo] = useState<{ paymentUrl: string; invoiceNo: string; amount: number } | null>(null);
  const [msg, setMsg] = useState("");

  async function startPay() {
    setMsg("");
    const res = await fetch(`/api/shop/order/${id}/payment`, { method: "POST" });
    const d = await res.json();
    if (!res.ok) return setMsg(d.error ?? "error");
    setInfo(d);
  }

  return (
    <main className="mx-auto max-w-md p-6 space-y-4">
      <h1 className="text-xl font-semibold">ชำระเงิน</h1>
      {!info ? (
        <Button onClick={startPay}>เริ่มชำระเงิน</Button>
      ) : (
        <div className="space-y-3 rounded border bg-white p-4">
          <p className="text-sm">ใบแจ้งหนี้: {info.invoiceNo}</p>
          <p className="text-sm">ยอดชำระ: {info.amount} บาท</p>
          <a className="text-blue-600 underline" href={info.paymentUrl}>
            ไปหน้าชำระเงิน (mock PSP)
          </a>
          <div>
            <Button onClick={() => router.push(`/shop/order/${id}`)}>ตรวจสอบสถานะ</Button>
          </div>
        </div>
      )}
      {msg && <p className="text-sm text-red-600">{msg}</p>}
    </main>
  );
}
