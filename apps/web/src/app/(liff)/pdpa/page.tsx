"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";

// PDPA consent screen (between OTP and ordering). Required consent gates progression;
// marketing consent is optional. Writes ConsentLog via /api/liff/consent.
export default function Pdpa() {
  const router = useRouter();
  const [required, setRequired] = useState(false);
  const [marketing, setMarketing] = useState(false);
  const [msg, setMsg] = useState("");

  async function submit() {
    setMsg("");
    const lineUserId = sessionStorage.getItem("lineUserId");
    if (!lineUserId) return router.push("/welcome");
    if (!required) return setMsg("กรุณายอมรับเงื่อนไขที่จำเป็นเพื่อใช้งานต่อ");

    const post = (purpose: string, granted: boolean) =>
      fetch("/api/liff/consent", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ lineUserId, purpose, granted }),
      });

    const res = await post("pdpa_required", true);
    const d = await res.json();
    if (!res.ok) return setMsg(d.error ?? "error");
    await post("pdpa_marketing", marketing);
    router.push("/lots");
  }

  return (
    <main className="mx-auto max-w-md p-6 space-y-4">
      <h1 className="text-xl font-semibold">ความยินยอม (PDPA)</h1>
      <p className="text-sm text-neutral-500">
        เราเก็บข้อมูลของคุณเพื่อให้บริการสั่งซื้อผลไม้และจัดส่ง ตามนโยบายความเป็นส่วนตัว
      </p>
      <label className="flex items-start gap-2 text-sm">
        <input type="checkbox" checked={required} onChange={(e) => setRequired(e.target.checked)} />
        <span>ฉันยอมรับการเก็บและใช้ข้อมูลส่วนบุคคลเพื่อใช้บริการ (จำเป็น)</span>
      </label>
      <label className="flex items-start gap-2 text-sm">
        <input type="checkbox" checked={marketing} onChange={(e) => setMarketing(e.target.checked)} />
        <span>ฉันยินยอมรับข่าวสารและโปรโมชัน (ไม่บังคับ)</span>
      </label>
      <Button onClick={submit}>ยอมรับและไปต่อ</Button>
      {msg && <p className="text-sm text-red-600">{msg}</p>}
    </main>
  );
}
