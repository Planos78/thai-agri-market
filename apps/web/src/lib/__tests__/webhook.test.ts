import { describe, it, expect, vi, beforeEach } from "vitest";

// DB-free unit test of register-code redeem + event handling. Mocks prisma with
// in-memory stores for registerCode, binding, botLog, and pushJob.

interface RegCode {
  id: string;
  code: string;
  orchardId: string;
  redeemedAt: Date | null;
  redeemedBy: string | null;
  expiresAt: Date | null;
}
interface Binding {
  orchardId: string;
  lineUserId: string;
}

const codes = new Map<string, RegCode>();
const bindings: Binding[] = [];
const botLogs: unknown[] = [];

function makeTx() {
  return {
    orchardRegisterCode: {
      findUnique: async ({ where }: { where: { code: string } }) =>
        [...codes.values()].find((c) => c.code === where.code) ?? null,
      update: async ({ where, data }: { where: { id: string }; data: Partial<RegCode> }) => {
        const c = { ...codes.get(where.id)!, ...data };
        codes.set(where.id, c);
        return c;
      },
    },
    orchardLineBinding: {
      findUnique: async ({ where }: { where: { orchardId_lineUserId: Binding } }) =>
        bindings.find(
          (b) =>
            b.orchardId === where.orchardId_lineUserId.orchardId &&
            b.lineUserId === where.orchardId_lineUserId.lineUserId,
        ) ?? null,
      create: async ({ data }: { data: Binding }) => {
        bindings.push(data);
        return data;
      },
    },
    lineBotLog: { create: async ({ data }: { data: unknown }) => (botLogs.push(data), data) },
    pushJob: { create: async ({ data }: { data: unknown }) => ({ id: "j1", ...(data as object) }) },
  };
}

const pushStore = new Map<string, { id: string; status: string; attempts: number; maxAttempts: number; nextAttemptAt: Date }>();

vi.mock("@/lib/db", () => ({
  prisma: {
    lineBotLog: { create: async ({ data }: { data: unknown }) => (botLogs.push(data), data) },
    // attemptPush (post-redeem confirmation push) uses the non-tx client.
    pushJob: {
      findUnique: async ({ where }: { where: { id: string } }) => pushStore.get(where.id) ?? null,
      update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        const row = { ...pushStore.get(where.id)!, ...data };
        pushStore.set(where.id, row);
        return row;
      },
    },
    $transaction: async (fn: (tx: unknown) => unknown) =>
      fn({
        ...makeTx(),
        pushJob: {
          create: async ({ data }: { data: Record<string, unknown> }) => {
            const id = `j-${pushStore.size + 1}`;
            const row = { id, status: "PENDING", attempts: 0, maxAttempts: 3, nextAttemptAt: new Date(), ...data };
            pushStore.set(id, row);
            return row;
          },
        },
      }),
  },
}));
vi.mock("@/lib/line", () => ({ getLine: () => ({ push: vi.fn().mockResolvedValue(undefined) }) }));

import { extractRegisterCode, redeemRegisterCode, handleLineEvent } from "@/lib/line-webhook";

beforeEach(() => {
  codes.clear();
  bindings.length = 0;
  botLogs.length = 0;
});

describe("extractRegisterCode", () => {
  it("finds a REG-XXXX code case-insensitively and uppercases it", () => {
    expect(extractRegisterCode("my code reg-ab12 thanks")).toBe("REG-AB12");
    expect(extractRegisterCode("REG-XYZ9")).toBe("REG-XYZ9");
  });
  it("returns null when no code present", () => {
    expect(extractRegisterCode("hello")).toBeNull();
    expect(extractRegisterCode(null)).toBeNull();
  });
});

describe("redeemRegisterCode", () => {
  it("valid code binds the user and marks it redeemed", async () => {
    codes.set("c1", { id: "c1", code: "REG-AB12", orchardId: "o1", redeemedAt: null, redeemedBy: null, expiresAt: null });
    const r = await redeemRegisterCode("REG-AB12", "U1");
    expect(r).toEqual({ ok: true, orchardId: "o1", alreadyBound: false });
    expect(codes.get("c1")!.redeemedAt).not.toBeNull();
    expect(codes.get("c1")!.redeemedBy).toBe("U1");
    expect(bindings).toEqual([{ orchardId: "o1", lineUserId: "U1" }]);
  });

  it("rejects an unknown code with no binding created", async () => {
    const r = await redeemRegisterCode("REG-NOPE", "U1");
    expect(r).toEqual({ ok: false, reason: "unknown" });
    expect(bindings).toHaveLength(0);
  });

  it("rejects an already-redeemed code", async () => {
    codes.set("c1", { id: "c1", code: "REG-AB12", orchardId: "o1", redeemedAt: new Date(), redeemedBy: "U0", expiresAt: null });
    const r = await redeemRegisterCode("REG-AB12", "U1");
    expect(r).toEqual({ ok: false, reason: "redeemed" });
    expect(bindings).toHaveLength(0);
  });

  it("rejects an expired code", async () => {
    codes.set("c1", { id: "c1", code: "REG-AB12", orchardId: "o1", redeemedAt: null, redeemedBy: null, expiresAt: new Date(Date.now() - 1000) });
    const r = await redeemRegisterCode("REG-AB12", "U1");
    expect(r).toEqual({ ok: false, reason: "expired" });
    expect(bindings).toHaveLength(0);
  });
});

describe("handleLineEvent", () => {
  it("logs a LineBotLog for every event", async () => {
    await handleLineEvent({ type: "follow", source: { userId: "U1" } });
    expect(botLogs).toHaveLength(1);
  });

  it("redeems when a message carries a valid register code", async () => {
    codes.set("c1", { id: "c1", code: "REG-AB12", orchardId: "o1", redeemedAt: null, redeemedBy: null, expiresAt: null });
    const r = await handleLineEvent({
      type: "message",
      source: { userId: "U1" },
      message: { type: "text", text: "REG-AB12" },
    });
    expect(r.handled).toBe(true);
    expect(bindings).toEqual([{ orchardId: "o1", lineUserId: "U1" }]);
  });

  it("does not redeem a plain text message", async () => {
    const r = await handleLineEvent({
      type: "message",
      source: { userId: "U1" },
      message: { type: "text", text: "hi there" },
    });
    expect(r.handled).toBe(false);
    expect(bindings).toHaveLength(0);
  });
});
