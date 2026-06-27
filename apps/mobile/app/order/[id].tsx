import { useState } from "react";
import { View, Text, Pressable, StyleSheet, ActivityIndicator } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { api } from "../../src/api/client";
import type { PaymentInitResponse } from "../../src/api/types";

// Order detail + pay/status (POST /api/shop/order/[id]/payment). Init payment via the mock PSP,
// render the returned amount + status. No real gateway in-app (mock-status only per spec).
export default function OrderDetail() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [info, setInfo] = useState<PaymentInitResponse | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function pay() {
    setBusy(true);
    setError("");
    try {
      const res = await api.initPayment(String(id));
      setInfo(res);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={styles.container}>
      <Text style={styles.label}>หมายเลขออเดอร์</Text>
      <Text style={styles.value}>{info?.orderNo ?? String(id)}</Text>

      {info ? (
        <>
          <Text style={styles.label}>ยอดชำระ</Text>
          <Text style={styles.amount}>{Number(info.amount).toFixed(2)} บาท</Text>
          {info.status ? <Text style={styles.status}>สถานะ: {info.status}</Text> : null}
          {info.invoiceNo ? <Text style={styles.meta}>ใบแจ้งหนี้: {info.invoiceNo}</Text> : null}
          {info.paymentUrl ? <Text style={styles.meta}>ลิงก์ชำระเงิน: {info.paymentUrl}</Text> : null}
        </>
      ) : null}

      <Pressable style={styles.button} disabled={busy} onPress={pay}>
        {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>{info ? "ชำระเงินอีกครั้ง" : "ชำระเงิน"}</Text>}
      </Pressable>

      <Pressable style={styles.secondary} onPress={() => router.replace("/orders")}>
        <Text style={styles.secondaryText}>ดูประวัติการสั่งซื้อ</Text>
      </Pressable>

      {error ? <Text style={styles.error}>{error}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 16, gap: 8 },
  label: { fontSize: 13, color: "#666", marginTop: 8 },
  value: { fontSize: 16, fontWeight: "600" },
  amount: { fontSize: 22, fontWeight: "700", color: "#0a7" },
  status: { fontSize: 14, fontWeight: "600" },
  meta: { color: "#666", fontSize: 13 },
  button: { backgroundColor: "#0a7", borderRadius: 8, padding: 14, alignItems: "center", marginTop: 16 },
  buttonText: { color: "#fff", fontWeight: "600" },
  secondary: { padding: 12, alignItems: "center" },
  secondaryText: { color: "#0a7", fontWeight: "600" },
  error: { color: "red", marginTop: 8 },
});
