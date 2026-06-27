import { useState } from "react";
import { View, Text, TextInput, Pressable, StyleSheet } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { api } from "../../src/api/client";

// Enter OTP -> verify (POST /api/shop/otp/check). Token is persisted to secure-store by the client.
export default function OtpScreen() {
  const router = useRouter();
  const { reference, devOtp } = useLocalSearchParams<{ reference: string; phone: string; devOtp?: string }>();
  const [otp, setOtp] = useState(typeof devOtp === "string" ? devOtp : "");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit() {
    setBusy(true);
    setError("");
    try {
      await api.checkOtp(String(reference), otp); // saves token in secure-store
      router.replace("/cart");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={styles.container}>
      <Text style={styles.label}>รหัส OTP</Text>
      {devOtp ? <Text style={styles.hint}>(dev OTP: {devOtp})</Text> : null}
      <TextInput style={styles.input} placeholder="123456" keyboardType="number-pad" value={otp} onChangeText={setOtp} />
      <Pressable style={styles.button} disabled={busy} onPress={submit}>
        <Text style={styles.buttonText}>{busy ? "..." : "ยืนยัน"}</Text>
      </Pressable>
      {error ? <Text style={styles.error}>{error}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 16, gap: 12 },
  label: { fontSize: 14, fontWeight: "600" },
  hint: { color: "#999", fontSize: 12 },
  input: { borderWidth: 1, borderColor: "#ccc", borderRadius: 8, padding: 12 },
  button: { backgroundColor: "#0a7", borderRadius: 8, padding: 14, alignItems: "center" },
  buttonText: { color: "#fff", fontWeight: "600" },
  error: { color: "red" },
});
