import { Stack } from "expo-router";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import { CartProvider } from "../src/cart/CartContext";

// Root layout: cart context + a simple stack navigator over the file-based routes.
export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <CartProvider>
        <StatusBar style="dark" />
        <Stack screenOptions={{ headerTitleStyle: { fontWeight: "600" } }}>
          <Stack.Screen name="index" options={{ title: "ตลาดผลไม้" }} />
          <Stack.Screen name="auth/phone" options={{ title: "เข้าสู่ระบบ" }} />
          <Stack.Screen name="auth/otp" options={{ title: "ยืนยัน OTP" }} />
          <Stack.Screen name="cart" options={{ title: "ตะกร้า" }} />
          <Stack.Screen name="order/[id]" options={{ title: "รายละเอียดออเดอร์" }} />
          <Stack.Screen name="orders" options={{ title: "ประวัติการสั่งซื้อ" }} />
        </Stack>
      </CartProvider>
    </SafeAreaProvider>
  );
}
