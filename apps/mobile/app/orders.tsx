import { useEffect, useState } from "react";
import { View, Text, FlatList, Pressable, StyleSheet, ActivityIndicator } from "react-native";
import { useRouter } from "expo-router";
import { api } from "../src/api/client";
import type { OrderHistoryItem } from "../src/api/types";

// Order history (GET /api/shop/orders, Bearer session). Tap an order to open its detail/pay screen.
// Redirects to login when there is no session token.
export default function OrderHistory() {
  const router = useRouter();
  const [orders, setOrders] = useState<OrderHistoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    api
      .orderHistory()
      .then((d) => setOrders(d.orders))
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <ActivityIndicator style={styles.center} />;
  if (error) {
    return (
      <View style={styles.container}>
        <Text style={styles.error}>{error}</Text>
        <Pressable style={styles.button} onPress={() => router.push("/auth/phone")}>
          <Text style={styles.buttonText}>เข้าสู่ระบบ</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <FlatList
        data={orders}
        keyExtractor={(o) => o.id}
        renderItem={({ item }) => (
          <Pressable
            style={styles.card}
            onPress={() => router.push({ pathname: "/order/[id]", params: { id: item.id } })}
          >
            <View style={styles.cardHead}>
              <Text style={styles.orderNo}>{item.orderNo}</Text>
              <Text style={styles.status}>{item.status}</Text>
            </View>
            <Text style={styles.meta}>
              {item.items.map((i) => `${i.fruitName} x${i.quantity}`).join(", ")}
            </Text>
            <Text style={styles.total}>{Number(item.totalAmount).toFixed(2)} บาท</Text>
          </Pressable>
        )}
        ListEmptyComponent={<Text style={styles.meta}>ยังไม่มีออเดอร์</Text>}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 16, gap: 8 },
  center: { flex: 1 },
  card: { borderBottomWidth: 1, borderColor: "#eee", paddingVertical: 12, gap: 4 },
  cardHead: { flexDirection: "row", justifyContent: "space-between" },
  orderNo: { fontSize: 15, fontWeight: "600" },
  status: { color: "#0a7", fontWeight: "600" },
  meta: { color: "#666", fontSize: 13 },
  total: { color: "#0a7", fontWeight: "600" },
  button: { backgroundColor: "#0a7", borderRadius: 8, padding: 14, alignItems: "center", marginTop: 12 },
  buttonText: { color: "#fff", fontWeight: "600" },
  error: { color: "red" },
});
