export default function ShopLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-neutral-50">
      <header className="border-b bg-white">
        <div className="mx-auto max-w-3xl px-6 py-4">
          <a href="/shop" className="text-lg font-semibold">
            Thai Agri Market
          </a>
        </div>
      </header>
      {children}
    </div>
  );
}
