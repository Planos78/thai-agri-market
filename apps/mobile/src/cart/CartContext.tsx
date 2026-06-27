import { createContext, useContext, useMemo, useState, type ReactNode } from "react";
import type { Lot } from "../api/types";

export interface CartLine {
  lot: Lot;
  quantity: number;
}

interface CartValue {
  lines: CartLine[];
  add: (lot: Lot, quantity: number) => void;
  remove: (lotId: string) => void;
  clear: () => void;
  total: number;
}

const CartContext = createContext<CartValue | null>(null);

export function CartProvider({ children }: { children: ReactNode }) {
  const [lines, setLines] = useState<CartLine[]>([]);

  const value = useMemo<CartValue>(() => {
    const total = lines.reduce((s, l) => s + Number(l.lot.price) * l.quantity, 0);
    return {
      lines,
      total,
      add: (lot, quantity) =>
        setLines((prev) => {
          const found = prev.find((l) => l.lot.id === lot.id);
          if (found) return prev.map((l) => (l.lot.id === lot.id ? { ...l, quantity: l.quantity + quantity } : l));
          return [...prev, { lot, quantity }];
        }),
      remove: (lotId) => setLines((prev) => prev.filter((l) => l.lot.id !== lotId)),
      clear: () => setLines([]),
    };
  }, [lines]);

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
}

export function useCart(): CartValue {
  const ctx = useContext(CartContext);
  if (!ctx) throw new Error("useCart must be used within CartProvider");
  return ctx;
}
