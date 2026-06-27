import { useState } from "react";
import { View, Text, TextInput, Pressable, FlatList, StyleSheet } from "react-native";
import { useRouter } from "expo-router";
import { api, getToken } from "../src/api/client";
import { useCart } from "../src/cart/CartContext";

// Cart -> create order (POST /api/shop/order, Bearer session). Redirects to login if no token.
export default function Cart() {
  const router = useRouter();
  const { lines, total, remove, clear } = useCart();
  const [address, setAddress] = useState("");
  const [phone, setPhone] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function confirm() {
    setError("");
    if (lines.length === 0) return setError("ตะกร้าว่าง");
    if (!address) return setError("กรุณากรอกที่อยู่จัดส่ง");
    const token = await getToken();
    if (!token) {
      router.push("/auth/phone");
      return;
    }
    setBusy(true);
    try {
      const res = await api.createOrder({
        items: lines.map((l) => ({ lotId: l.lot.id, quantity: l.quantity })),
        shippingAddress: address,
        phone,
      });
      clear();
      router.replace({ pathname: "/order/[id]", params: { id: res.order.id } });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={styles.container}>
      <FlatList
        data={lines}
        keyExtractor={(l) => l.lot.id}
        renderItem={({ item }) => (
          <View style={styles.row}>
            <Text style={styles.name}>{item.lot.fruitName} x{item.quantity}</Text>
            <Text style={styles.price}>{(Number(item.lot.price) * item.quantity).toFixed(2)}</Text>
            <Pressable onPress={() => remove(item.lot.id)}><Text style={styles.remove}>ลบ</Text></Pressable>
          </View>
        )}
        ListEmptyComponent={<Text style={styles.meta}>ตะกร้าว่าง</Text>}
      />
      <Text style={styles.total}>รวม {total.toFixed(2)} บาท</Text>
      <TextInput style={styles.input} placeholder="ที่อยู่จัดส่ง" value={address} onChangeText={setAddress} />
      <TextInput style={styles.input} placeholder="เบอร์โทร (ต้องตรงกับที่ยืนยัน)" keyboardType="phone-pad" value={phone} onChangeText={setPhone} />
      <Pressable style={styles.button} disabled={busy} onPress={confirm}>
        <Text style={styles.buttonText}>{busy ? "..." : "ยืนยันสั่งซื้อ"}</Text>
      </Pressable>
      {error ? <Text style={styles.error}>{error}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 16, gap: 10 },
  row: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 8, borderBottomWidth: 1, borderColor: "#eee" },
  name: { flex: 1 },
  price: { color: "#0a7" },
  remove: { color: "red" },
  meta: { color: "#666" },
  total: { fontWeight: "700", fontSize: 16, marginTop: 8 },
  input: { borderWidth: 1, borderColor: "#ccc", borderRadius: 8, padding: 12 },
  button: { backgroundColor: "#0a7", borderRadius: 8, padding: 14, alignItems: "center" },
  buttonText: { color: "#fff", fontWeight: "600" },
  error: { color: "red" },
});
