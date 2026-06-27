import { prisma } from "@/lib/db";

// Server component: order status (read-only). Next 16: params is a Promise.
export default async function ShopOrderStatus({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const order = await prisma.order.findUnique({
    where: { id },
    include: { items: true, payment: true },
  });

  if (!order) {
    return <main className="mx-auto max-w-md p-6">ไม่พบคำสั่งซื้อ</main>;
  }

  return (
    <main className="mx-auto max-w-md p-6 space-y-3">
      <h1 className="text-xl font-semibold">คำสั่งซื้อ {order.orderNo}</h1>
      <p className="text-sm">สถานะ: {order.status}</p>
      <p className="text-sm">การชำระเงิน: {order.payment?.status ?? "-"}</p>
      <p className="text-sm">ยอดรวม: {Number(order.totalAmount)} บาท</p>
      <ul className="text-sm text-neutral-600">
        {order.items.map((it) => (
          <li key={it.id}>
            lot {it.lotId.slice(0, 8)} · จำนวน {it.quantity} · {Number(it.price)} บาท
          </li>
        ))}
      </ul>
    </main>
  );
}
