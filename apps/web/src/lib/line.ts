// Swappable LINE adapter (decision #6 clean break: server-verify ID token, no MD5/AES).
// Convention: real vendor stays mock by default; real adapter is env-gated and throws
// loud if selected without creds (mirror lib/psp.ts). Nothing goes live without LINE_PROVIDER=line.
// Mock verifier accepts tokens shaped "mock:<lineUserId>[:<name>]".
export interface LineProfile {
  lineUserId: string;
  name?: string;
}

export interface LineAdapter {
  verifyIdToken(idToken: string): Promise<LineProfile | null>;
  push(lineUserId: string, message: string): Promise<void>;
}

class MockLine implements LineAdapter {
  async verifyIdToken(idToken: string): Promise<LineProfile | null> {
    const m = (idToken ?? "").match(/^mock:([^:]+)(?::(.+))?$/);
    if (!m) return null;
    return { lineUserId: m[1], name: m[2] };
  }
  async push(lineUserId: string, message: string): Promise<void> {
    console.log(`[mock-line push] -> ${lineUserId}: ${message}`);
  }
}

// Real LINE adapter. verifyIdToken uses LINE's documented /verify endpoint (no manual
// JWKS); push uses the Messaging API. Both require creds; throw loud if missing.
class LineRealAdapter implements LineAdapter {
  constructor(
    private channelId: string,
    private accessToken: string | undefined,
  ) {}

  async verifyIdToken(idToken: string): Promise<LineProfile | null> {
    if (!idToken) return null;
    const res = await fetch("https://api.line.me/oauth2/v2.1/verify", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ id_token: idToken, client_id: this.channelId }),
    });
    if (!res.ok) return null;
    const claims = (await res.json()) as {
      iss?: string;
      sub?: string;
      aud?: string;
      exp?: number;
      name?: string;
    };
    if (claims.iss !== "https://access.line.me") return null;
    if (claims.aud !== this.channelId) return null;
    if (!claims.sub) return null;
    if (typeof claims.exp === "number" && claims.exp * 1000 <= Date.now()) return null;
    return { lineUserId: claims.sub, name: claims.name };
  }

  async push(lineUserId: string, message: string): Promise<void> {
    if (!this.accessToken) throw new Error("LINE_CHANNEL_ACCESS_TOKEN required for real push");
    const res = await fetch("https://api.line.me/v2/bot/message/push", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${this.accessToken}`,
      },
      body: JSON.stringify({ to: lineUserId, messages: [{ type: "text", text: message }] }),
    });
    if (!res.ok) {
      throw new Error(`LINE push failed: ${res.status} ${await res.text().catch(() => "")}`);
    }
  }
}

export function getLine(): LineAdapter {
  switch (process.env.LINE_PROVIDER ?? "mock") {
    case "line": {
      const channelId = process.env.LINE_CHANNEL_ID;
      if (!channelId) {
        throw new Error("LINE_PROVIDER=line but LINE_CHANNEL_ID is not set (no silent mock fallback)");
      }
      return new LineRealAdapter(channelId, process.env.LINE_CHANNEL_ACCESS_TOKEN);
    }
    case "mock":
    default:
      return new MockLine();
  }
}

// Internal push relay (roadmap note 4: app never calls LINE directly; it goes through
// this relay). P3 backs this with a durable retry/queue (blueprint bug #5 fix): enqueue
// a PushJob then attempt it. Import here is local to avoid a cycle with lib/push.ts.
export async function relayPush(event: string, lineUserId: string, message: string): Promise<void> {
  const { prisma } = await import("@/lib/db");
  const { enqueuePush, attemptPush } = await import("@/lib/push");
  const jobId = await prisma.$transaction((tx) => enqueuePush(tx, { event, lineUserId, message }));
  await attemptPush(jobId);
}
