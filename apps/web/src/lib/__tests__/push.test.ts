import { describe, it, expect, vi, beforeEach } from "vitest";

// DB-free unit test of the PushJob state machine. We mock the prisma client and the
// LINE adapter; the in-memory store models a single PushJob row.

interface JobRow {
  id: string;
  event: string;
  lineUserId: string;
  message: string;
  status: "PENDING" | "SENT" | "FAILED";
  attempts: number;
  maxAttempts: number;
  lastError: string | null;
  nextAttemptAt: Date;
  sentAt: Date | null;
}

const store = new Map<string, JobRow>();

vi.mock("@/lib/db", () => ({
  prisma: {
    pushJob: {
      create: async ({ data }: { data: Partial<JobRow> }) => {
        const id = `job-${store.size + 1}`;
        const row: JobRow = {
          id,
          event: data.event ?? "",
          lineUserId: data.lineUserId ?? "",
          message: data.message ?? "",
          status: data.status ?? "PENDING",
          attempts: data.attempts ?? 0,
          maxAttempts: data.maxAttempts ?? 3,
          lastError: data.lastError ?? null,
          nextAttemptAt: data.nextAttemptAt ?? new Date(),
          sentAt: data.sentAt ?? null,
        };
        store.set(id, row);
        return row;
      },
      findUnique: async ({ where }: { where: { id: string } }) => store.get(where.id) ?? null,
      findMany: async () => [...store.values()],
      update: async ({ where, data }: { where: { id: string }; data: Partial<JobRow> }) => {
        const row = { ...store.get(where.id)!, ...data };
        store.set(where.id, row);
        return row;
      },
    },
    orchardLineBinding: { findMany: async () => [] },
    $transaction: async (fn: (tx: unknown) => unknown) =>
      fn({
        pushJob: {
          create: async ({ data }: { data: Partial<JobRow> }) => {
            const id = `job-${store.size + 1}`;
            const row: JobRow = {
              id,
              event: data.event ?? "",
              lineUserId: data.lineUserId ?? "",
              message: data.message ?? "",
              status: data.status ?? "PENDING",
              attempts: 0,
              maxAttempts: 3,
              lastError: null,
              nextAttemptAt: new Date(),
              sentAt: null,
            };
            store.set(id, row);
            return row;
          },
        },
      }),
  },
}));

const pushMock = vi.fn();
vi.mock("@/lib/line", () => ({ getLine: () => ({ push: pushMock }) }));

import { enqueuePush, attemptPush } from "@/lib/push";
import { prisma } from "@/lib/db";

beforeEach(() => {
  store.clear();
  pushMock.mockReset();
});

describe("PushJob state machine", () => {
  it("PENDING -> SENT on adapter success, with sentAt and attempts incremented", async () => {
    pushMock.mockResolvedValue(undefined);
    const id = await prisma.$transaction((tx) =>
      enqueuePush(tx as never, { event: "e", lineUserId: "U1", message: "m" }),
    );
    const r = await attemptPush(id);
    expect(r.status).toBe("SENT");
    const row = store.get(id)!;
    expect(row.status).toBe("SENT");
    expect(row.sentAt).not.toBeNull();
    expect(row.attempts).toBe(1);
  });

  it("PENDING -> PENDING(+backoff) on transient failure below maxAttempts", async () => {
    pushMock.mockRejectedValue(new Error("boom"));
    const id = await prisma.$transaction((tx) =>
      enqueuePush(tx as never, { event: "e", lineUserId: "U1", message: "m" }),
    );
    const r = await attemptPush(id);
    expect(r.status).toBe("PENDING");
    const row = store.get(id)!;
    expect(row.attempts).toBe(1);
    expect(row.lastError).toBe("boom");
    expect(row.nextAttemptAt.getTime()).toBeGreaterThan(Date.now());
  });

  it("-> FAILED once attempts reach maxAttempts", async () => {
    pushMock.mockRejectedValue(new Error("boom"));
    const id = await prisma.$transaction((tx) =>
      enqueuePush(tx as never, { event: "e", lineUserId: "U1", message: "m" }),
    );
    await attemptPush(id); // 1
    await attemptPush(id); // 2
    const r = await attemptPush(id); // 3 -> FAILED
    expect(r.status).toBe("FAILED");
    expect(store.get(id)!.status).toBe("FAILED");
    expect(store.get(id)!.attempts).toBe(3);
  });

  it("attemptPush never throws even when the adapter throws", async () => {
    pushMock.mockRejectedValue(new Error("boom"));
    const id = await prisma.$transaction((tx) =>
      enqueuePush(tx as never, { event: "e", lineUserId: "U1", message: "m" }),
    );
    await expect(attemptPush(id)).resolves.toBeDefined();
  });

  it("a SENT job is idempotent (re-attempt is a no-op)", async () => {
    pushMock.mockResolvedValue(undefined);
    const id = await prisma.$transaction((tx) =>
      enqueuePush(tx as never, { event: "e", lineUserId: "U1", message: "m" }),
    );
    await attemptPush(id);
    pushMock.mockClear();
    const r = await attemptPush(id);
    expect(r.status).toBe("SENT");
    expect(pushMock).not.toHaveBeenCalled();
  });
});
