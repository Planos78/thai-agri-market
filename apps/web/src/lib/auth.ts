import crypto from "node:crypto";
import { SignJWT, jwtVerify } from "jose";

// --- password (scrypt; no native bcrypt dep) ---
export function hashPassword(pw: string): string {
  const salt = crypto.randomBytes(16).toString("hex");
  const dk = crypto.scryptSync(pw, salt, 64).toString("hex");
  return `${salt}:${dk}`;
}

export function verifyPassword(pw: string, stored: string): boolean {
  const [salt, dk] = (stored ?? "").split(":");
  if (!salt || !dk) return false;
  const got = crypto.scryptSync(pw, salt, 64).toString("hex");
  const a = Buffer.from(dk);
  const b = Buffer.from(got);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// --- admin JWT (self-issued; swappable for a hosted provider later, decision #5) ---
const jwtSecret = () => new TextEncoder().encode(process.env.ADMIN_JWT_SECRET ?? "dev-admin-secret");

export interface AdminClaims {
  sub: string;
  email: string;
  perms: string[];
}

export async function signAdminJwt(claims: AdminClaims): Promise<string> {
  return new SignJWT({ email: claims.email, perms: claims.perms })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(claims.sub)
    .setIssuedAt()
    .setExpirationTime("8h")
    .sign(jwtSecret());
}

export async function verifyAdminJwt(token: string): Promise<AdminClaims | null> {
  try {
    const { payload } = await jwtVerify(token, jwtSecret());
    return {
      sub: String(payload.sub),
      email: String(payload.email ?? ""),
      perms: Array.isArray(payload.perms) ? (payload.perms as string[]) : [],
    };
  } catch {
    return null;
  }
}

// Pull bearer token from an Authorization header.
export function bearer(req: Request): string | null {
  const h = req.headers.get("authorization") ?? "";
  const m = h.match(/^Bearer\s+(.+)$/i);
  return m ? m[1] : null;
}

// --- P5 web-shop session (guest phone-OTP; reuses jose; separate secret from admin) ---
const shopSecret = () => new TextEncoder().encode(process.env.SHOP_SESSION_SECRET ?? "dev-shop-secret");

export const SHOP_SESSION_COOKIE = "shop_session";

export interface ShopClaims {
  phone: string;
}

export async function signShopSession(claims: ShopClaims): Promise<string> {
  return new SignJWT({ phone: claims.phone })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("2h")
    .sign(shopSecret());
}

export async function verifyShopSession(token: string): Promise<ShopClaims | null> {
  try {
    const { payload } = await jwtVerify(token, shopSecret());
    const phone = String(payload.phone ?? "");
    return phone ? { phone } : null;
  } catch {
    return null;
  }
}

// Read the shop session from the httpOnly cookie OR an Authorization: Bearer token.
// P6: native mobile has no shared cookie jar -> accept the same signed token as a bearer
// (additive + backward-compatible; the web cookie path is unchanged).
export async function shopSessionFromRequest(req: Request): Promise<ShopClaims | null> {
  const cookie = req.headers.get("cookie") ?? "";
  const m = cookie.match(/(?:^|;\s*)shop_session=([^;]+)/);
  if (m) {
    const fromCookie = await verifyShopSession(decodeURIComponent(m[1]));
    if (fromCookie) return fromCookie;
  }
  const token = bearer(req);
  if (token) return verifyShopSession(token);
  return null;
}
