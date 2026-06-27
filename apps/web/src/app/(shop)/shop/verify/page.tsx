"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";

export default function ShopVerify() {
  const router = useRouter();
  const [phone, setPhone] = useState("");
  const [otp, setOtp] = useState("");
  const [reference, setReference] = useState("");
  const [hint, setHint] = useState("");
  const [msg, setMsg] = useState("");

  async function sendOtp() {
    setMsg("");
    const res = await fetch("/api/shop/otp", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ phone }),
    });
    const d = await res.json();
    if (!res.ok) return setMsg(d.error ?? "error");
    setReference(d.reference);
    if (d.devOtp) setHint(`(dev OTP: ${d.devOtp})`);
  }

  async function verify() {
    setMsg("");
    const checkRes = await fetch("/api/shop/otp/check", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ reference, otp }),
    });
    const c = await checkRes.json();
    if (!checkRes.ok) return setMsg(c.error ?? "error");

    // Session cookie set; create the order.
    const cart = JSON.parse(sessionStorage.getItem("shopCart") ?? "[]");
    const shippingAddress = sessionStorage.getItem("shopAddress") ?? "";
    const orderRes = await fetch("/api/shop/order", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ items: cart, shippingAddress, phone }),
    });
    const o = await orderRes.json();
    if (!orderRes.ok) return setMsg(o.error ?? "order error");
    sessionStorage.removeItem("shopCart");
    router.push(`/shop/order/${o.order.id}/pay`);
  }

  return (
    <main className="mx-auto max-w-md p-6 space-y-4">
      <h1 className="text-xl font-semibold">ยืนยันเบอร์โทร</h1>
      {!reference ? (
        <>
          <input
            className="w-full rounded border px-3 py-2"
            placeholder="เบอร์โทรศัพท์"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
          />
          <Button onClick={sendOtp} disabled={!phone}>
            ส่ง OTP
          </Button>
        </>
      ) : (
        <>
          <p className="text-sm text-neutral-500">{hint}</p>
          <input
            className="w-full rounded border px-3 py-2"
            placeholder="OTP 6 หลัก"
            value={otp}
            onChange={(e) => setOtp(e.target.value)}
          />
          <Button onClick={verify} disabled={!otp}>
            ยืนยันและสั่งซื้อ
          </Button>
        </>
      )}
      {msg && <p className="text-sm text-red-600">{msg}</p>}
    </main>
  );
}
