// Response types hand-mirrored from the web JSON API (no build-time import across apps).
// Keep in sync with apps/web src/app/api/{shop,liff}/**.

export interface Lot {
  id: string;
  fruitName: string;
  variety: string | null;
  grade: string | null;
  price: string; // Decimal serialized as string
  quantity: number;
  unit: string;
  minOrderQty: number | null;
  orchard: { name: string; province: string } | null;
}

export interface OtpResponse {
  reference: string;
  devOtp?: string; // present only when SMS_PROVIDER=mock
}

export interface OtpCheckResponse {
  verified: boolean;
  phone: string;
  token: string; // P6: shop session token (sent as Bearer)
}

export interface OrderItemInput {
  lotId: string;
  quantity: number;
}

export interface OrderSummary {
  id: string;
  orderNo: string;
  status: string;
  totalAmount: string;
}

export interface CreateOrderResponse {
  order: OrderSummary;
}

export interface PaymentInitResponse {
  orderNo?: string;
  amount: number;
  invoiceNo?: string;
  paymentUrl?: string;
  status?: string;
}

export interface OrderHistoryItem {
  id: string;
  orderNo: string;
  status: string;
  totalAmount: string;
  createdAt: string;
  items: { fruitName: string; quantity: number; price: string }[];
}

export interface OrderHistoryResponse {
  orders: OrderHistoryItem[];
}
