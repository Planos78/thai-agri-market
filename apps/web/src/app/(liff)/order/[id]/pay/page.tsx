"use client";
import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { Button } from "@/components/ui/button";

export default function Pay() {
  const { id } = useParams<{ id: string }>();
  const [info, setInfo] = useState<{ invoiceNo: string; amount: number } | null>(null);
  const [status, setStatus] = useState("");
  const [msg, setMsg] = useState("");

  useEffect(() => {
    fetch(`/api/liff/order/${id}/payment`, { method: "POST" })
      .then((r) => r.json().then((d) => ({ ok: r.ok, d })))
      .then(({ ok, d }) => (ok ? setInfo(d) : setMsg(d.error ?? "error")));
  }, [id]);

  async function pay() {
    if (!info) return;
    const res = await fetch("/api/dev/mock-pay", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ invoiceNo: info.invoiceNo, amount: info.amount }),
    });
    const d = await res.json();
    setStatus(d.forwarded ? "ชำระเงินสำเร็จ (mock) — ออเดอร์ PAID" : `ล้มเหลว (${d.status})`);
  }

  return (
    <main className="mx-auto max-w-md p-6 space-y-4">
      <h1 className="text-xl font-semibold">ชำระเงิน</h1>
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
