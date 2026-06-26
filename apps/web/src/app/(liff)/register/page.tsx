"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";

export default function Register() {
  const router = useRouter();
  const [phone, setPhone] = useState("");
  const [name, setName] = useState("");
  const [msg, setMsg] = useState("");

  async function sendOtp() {
    setMsg("");
    const lineUserId = sessionStorage.getItem("lineUserId");
    if (!lineUserId) return router.push("/welcome");
    const res = await fetch("/api/liff/otp", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ phone, lineUserId }),
    });
    const d = await res.json();
    if (!res.ok) return setMsg(d.error ?? "error");
    sessionStorage.setItem("otpRef", d.reference);
    sessionStorage.setItem("name", name);
    if (d.devOtp) sessionStorage.setItem("devOtp", d.devOtp);
    router.push("/otp");
  }

  return (
    <main className="mx-auto max-w-md p-6 space-y-4">
      <h1 className="text-xl font-semibold">ยืนยันเบอร์โทร</h1>
      <input className="w-full rounded border px-3 py-2" value={name} onChange={(e) => setName(e.target.value)} placeholder="ชื่อ" />
      <input className="w-full rounded border px-3 py-2" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="เบอร์โทร" />
      <Button onClick={sendOtp}>ส่ง OTP</Button>
      {msg && <p className="text-sm text-red-600">{msg}</p>}
    </main>
  );
}
