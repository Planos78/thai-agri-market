"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";

export default function Otp() {
  const router = useRouter();
  const [otp, setOtp] = useState("");
  const [hint, setHint] = useState("");
  const [msg, setMsg] = useState("");

  useEffect(() => {
    const dev = sessionStorage.getItem("devOtp");
    if (dev) setHint(`(dev OTP: ${dev})`);
  }, []);

  async function verify() {
    setMsg("");
    const reference = sessionStorage.getItem("otpRef");
    const name = sessionStorage.getItem("name");
    const res = await fetch("/api/liff/otp/check", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ reference, otp, name }),
    });
    const d = await res.json();
    if (!res.ok) return setMsg(d.error ?? "error");
    router.push("/pdpa");
  }

  return (
    <main className="mx-auto max-w-md p-6 space-y-4">
      <h1 className="text-xl font-semibold">กรอก OTP</h1>
      <p className="text-sm text-neutral-500">{hint}</p>
      <input className="w-full rounded border px-3 py-2" value={otp} onChange={(e) => setOtp(e.target.value)} placeholder="OTP 6 หลัก" />
      <Button onClick={verify}>ยืนยัน</Button>
      {msg && <p className="text-sm text-red-600">{msg}</p>}
    </main>
  );
}
