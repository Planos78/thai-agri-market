import * as SecureStore from "expo-secure-store";
import type {
  Lot,
  OtpResponse,
  OtpCheckResponse,
  OrderItemInput,
  CreateOrderResponse,
  PaymentInitResponse,
  OrderHistoryResponse,
} from "./types";

// Base URL from env (EXPO_PUBLIC_* is inlined at build by Expo). Default to localhost dev.
const BASE_URL = process.env.EXPO_PUBLIC_API_URL ?? "http://localhost:3000";

const TOKEN_KEY = "shop_session_token";

// --- token storage (expo-secure-store) ---
export async function saveToken(token: string): Promise<void> {
  await SecureStore.setItemAsync(TOKEN_KEY, token);
}
export async function getToken(): Promise<string | null> {
  return SecureStore.getItemAsync(TOKEN_KEY);
}
export async function clearToken(): Promise<void> {
  await SecureStore.deleteItemAsync(TOKEN_KEY);
}

// Typed fetch wrapper. Injects the bearer token from secure-store when `auth` is set.
async function request<T>(
  path: string,
  opts: { method?: string; body?: unknown; auth?: boolean } = {},
): Promise<T> {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (opts.auth) {
    const token = await getToken();
    if (token) headers.authorization = `Bearer ${token}`;
  }
  const res = await fetch(`${BASE_URL}${path}`, {
    method: opts.method ?? "GET",
    headers,
    body: opts.body != null ? JSON.stringify(opts.body) : undefined,
  });
  const data = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) {
    throw new Error((data as { error?: string }).error ?? `request failed (${res.status})`);
  }
  return data as T;
}

// --- endpoints (reuse existing web JSON API) ---
export const api = {
  baseUrl: BASE_URL,

  listLots(): Promise<{ lots: Lot[] }> {
    return request<{ lots: Lot[] }>("/api/shop/lots");
  },

  requestOtp(phone: string): Promise<OtpResponse> {
    return request<OtpResponse>("/api/shop/otp", { method: "POST", body: { phone } });
  },

  // P6: otp/check now returns the token in the body; persist it in secure-store.
  async checkOtp(reference: string, otp: string): Promise<OtpCheckResponse> {
    const res = await request<OtpCheckResponse>("/api/shop/otp/check", {
      method: "POST",
      body: { reference, otp },
    });
    if (res.token) await saveToken(res.token);
    return res;
  },

  createOrder(opts: { items: OrderItemInput[]; shippingAddress: string; phone: string }): Promise<CreateOrderResponse> {
    return request<CreateOrderResponse>("/api/shop/order", { method: "POST", body: opts, auth: true });
  },

  initPayment(orderId: string): Promise<PaymentInitResponse> {
    return request<PaymentInitResponse>(`/api/shop/order/${orderId}/payment`, { method: "POST", body: {}, auth: true });
  },

  orderHistory(): Promise<OrderHistoryResponse> {
    return request<OrderHistoryResponse>("/api/shop/orders", { auth: true });
  },
};
