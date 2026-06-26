"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";

export default function AdminLogin() {
  const router = useRouter();
  const [email, setEmail] = useState("admin@thaiagri.local");
  const [password, setPassword] = useState("");
  const [msg, setMsg] = useState("");

  async function login() {
    setMsg("");
    const res = await fetch("/api/admin/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    const d = await res.json();
    if (!res.ok) return setMsg(d.error ?? "error");
    sessionStorage.setItem("adminToken", d.token);
    router.push("/admin/orders");
  }

  return (
    <main className="mx-auto max-w-md p-6 space-y-4">
      <h1 className="text-xl font-semibold">Admin Login</h1>
      <input className="w-full rounded border px-3 py-2" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="email" />
      <input type="password" className="w-full rounded border px-3 py-2" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="password" />
      <Button onClick={login}>เข้าสู่ระบบ</Button>
      {msg && <p className="text-sm text-red-600">{msg}</p>}
    </main>
  );
}
