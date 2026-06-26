"use client";
import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { Button } from "@/components/ui/button";

// Checkout for pay-more on an approved INCREASE adjustment (clone of order/[id]/pay).
export default function IncreasePay() {
  const { ipid } = useParams<{ id: string; ipid: string }>();
  const [info, setInfo] = useState<{ invoiceNo: string; amount: number } | null>(null);
  const [status, setStatus] = useState("");
  const [msg, setMsg] = useState("");

  useEffect(() => {
    const lineUserId = sessionStorage.getItem("lineUserId") ?? "";
    fetch(`/api/liff/increase-payment/${ipid}/pay`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ lineUserId }),
    })
      .then((r) => r.json().then((d) => ({ ok: r.ok, d })))
      .then(({ ok, d }) => (ok ? setInfo(d) : setMsg(d.error ?? "error")));
  }, [ipid]);

  async function pay() {
    if (!info) return;
    const res = await fetch("/api/dev/mock-pay", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ invoiceNo: info.invoiceNo, amount: info.amount }),
    });
    const d = await res.json();
    setStatus(d.forwarded ? "ชำระเงินเพิ่มสำเร็จ (mock)" : `ล้มเหลว (${d.status})`);
  }

  return (
    <main className="mx-auto max-w-md p-6 space-y-4">
      <h1 className="text-xl font-semibold">ชำระค่าสินค้าเพิ่ม</h1>
      {msg && <p className="text-sm text-red-600">{msg}</p>}
      {info && (
        <>
          <p className="text-sm">Invoice {info.invoiceNo} · ยอด {info.amount} บาท</p>
          <Button onClick={pay}>จ่ายเงิน (mock PSP)</Button>
        </>
      )}
      {status && <p className="text-sm text-green-600">{status}</p>}
    </main>
  );
}
