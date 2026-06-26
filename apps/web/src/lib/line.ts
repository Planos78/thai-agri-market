// Swappable LINE adapter (decision #6 clean break: server-verify ID token, no MD5/AES).
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

export function getLine(): LineAdapter {
  switch (process.env.LINE_PROVIDER ?? "mock") {
    case "mock":
    default:
      return new MockLine();
  }
}

// Internal push relay (roadmap note 4: app never calls LINE directly; it goes through
// this relay, which the /api/internal/push/[event] route also wraps). P1 is in-process;
// P3 backs this with a retry/queue (blueprint bug #5 fix).
export async function relayPush(event: string, lineUserId: string, message: string): Promise<void> {
  await getLine().push(lineUserId, `[${event}] ${message}`);
}
