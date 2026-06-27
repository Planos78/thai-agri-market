import { useEffect, useState } from "react";
import { View, Text, FlatList, Pressable, StyleSheet, ActivityIndicator } from "react-native";
import { Link, useRouter } from "expo-router";
import { api } from "../src/api/client";
import type { Lot } from "../src/api/types";
import { useCart } from "../src/cart/CartContext";

// Browse lots (GET /api/shop/lots). Tap to add to cart.
export default function BrowseLots() {
  const router = useRouter();
  const { add, lines } = useCart();
  const [lots, setLots] = useState<Lot[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    api
      .listLots()
      .then((d) => setLots(d.lots))
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <ActivityIndicator style={styles.center} />;
  if (error) return <Text style={styles.error}>{error}</Text>;

  return (
    <View style={styles.container}>
      <View style={styles.bar}>
        <Link href="/cart" style={styles.link}>ตะกร้า ({lines.length})</Link>
        <Link href="/orders" style={styles.link}>ประวัติ</Link>
        <Link href="/auth/phone" style={styles.link}>เข้าสู่ระบบ</Link>
      </View>
      <FlatList
        data={lots}
        keyExtractor={(l) => l.id}
        renderItem={({ item }) => (
          <Pressable style={styles.card} onPress={() => { add(item, item.minOrderQty ?? 1); router.push("/cart"); }}>
            <Text style={styles.title}>{item.fruitName}{item.variety ? ` (${item.variety})` : ""}</Text>
            <Text style={styles.meta}>{item.orchard?.name ?? "-"} · {item.orchard?.province ?? "-"}</Text>
            <Text style={styles.price}>{item.price} บาท/{item.unit}</Text>
          </Pressable>
        )}
        ListEmptyComponent={<Text style={styles.meta}>ยังไม่มีสินค้า</Text>}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 16 },
  center: { flex: 1 },
  error: { color: "red", padding: 16 },
  bar: { flexDirection: "row", gap: 16, marginBottom: 12 },
  link: { color: "#0a7", fontWeight: "600" },
  card: { borderBottomWidth: 1, borderColor: "#eee", paddingVertical: 12 },
  title: { fontSize: 16, fontWeight: "600" },
  meta: { color: "#666", fontSize: 13 },
  price: { color: "#0a7", fontWeight: "600", marginTop: 4 },
});
