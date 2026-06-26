"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";

export default function Welcome() {
  const router = useRouter();
  const [lineUserId, setLineUserId] = useState("mock-buyer-1");
  const [msg, setMsg] = useState("");

  async function enter() {
    setMsg("");
    const res = await fetch("/api/liff/verify-line", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ idToken: `mock:${lineUserId}` }),
    });
    const d = await res.json();
    if (!res.ok) return setMsg(d.error ?? "error");
    sessionStorage.setItem("lineUserId", d.lineUserId);
    router.push(d.verified ? "/lots" : "/register");
  }

  return (
    <main className="mx-auto max-w-md p-6 space-y-4">
      <h1 className="text-xl font-semibold">Thai Agri Market</h1>
      <p className="text-sm text-neutral-500">เข้าสู่ระบบผ่าน LINE (mock)</p>
      <input
        className="w-full rounded border px-3 py-2"
        value={lineUserId}
        onChange={(e) => setLineUserId(e.target.value)}
        placeholder="mock LINE user id"
      />
      <Button onClick={enter}>เข้าสู่ระบบ</Button>
      {msg && <p className="text-sm text-red-600">{msg}</p>}
    </main>
  );
}
