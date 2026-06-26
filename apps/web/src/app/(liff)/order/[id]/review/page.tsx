"use client";
import { useState } from "react";
import { useParams } from "next/navigation";
import { Button } from "@/components/ui/button";

// Buyer review (star rating + comment); only accepted when the order is DELIVERED.
export default function Review() {
  const { id } = useParams<{ id: string }>();
  const [rating, setRating] = useState(5);
  const [comment, setComment] = useState("");
  const [msg, setMsg] = useState("");

  async function submit() {
    const lineUserId = sessionStorage.getItem("lineUserId") ?? "";
    const res = await fetch(`/api/liff/order/${id}/review`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ lineUserId, rating, comment }),
    });
    const d = await res.json();
    setMsg(res.ok ? `ขอบคุณสำหรับรีวิว (เรตติ้งสวน ${d.orchardRating})` : d.error ?? "error");
  }

  return (
    <main className="mx-auto max-w-md p-6 space-y-4">
      <h1 className="text-xl font-semibold">รีวิวสินค้า</h1>
      <div className="flex gap-1 text-2xl">
        {[1, 2, 3, 4, 5].map((n) => (
          <button key={n} type="button" onClick={() => setRating(n)} className={n <= rating ? "text-yellow-500" : "text-gray-300"}>
            ★
          </button>
        ))}
      </div>
      <textarea className="w-full rounded border p-2 text-sm" rows={3} placeholder="ความคิดเห็น (ไม่บังคับ)" value={comment} onChange={(e) => setComment(e.target.value)} />
      <Button onClick={submit}>ส่งรีวิว</Button>
      {msg && <p className="text-sm text-primary">{msg}</p>}
    </main>
  );
}
