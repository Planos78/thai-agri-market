import { describe, it, expect, afterEach } from "vitest";
import { getLine } from "@/lib/line";

const SAVE = { ...process.env };
afterEach(() => {
  process.env = { ...SAVE };
});

describe("line adapter selector + mock verifier", () => {
  it("mock mode parses mock:<id>[:<name>]", async () => {
    process.env.LINE_PROVIDER = "mock";
    const line = getLine();
    expect(await line.verifyIdToken("mock:U123:Somchai")).toEqual({
      lineUserId: "U123",
      name: "Somchai",
    });
    expect(await line.verifyIdToken("mock:U999")).toEqual({ lineUserId: "U999", name: undefined });
  });

  it("mock mode rejects a non-mock token", async () => {
    process.env.LINE_PROVIDER = "mock";
    expect(await getLine().verifyIdToken("garbage")).toBeNull();
    expect(await getLine().verifyIdToken("")).toBeNull();
  });

  it("real mode throws loud when LINE_CHANNEL_ID is missing (no silent mock)", () => {
    process.env.LINE_PROVIDER = "line";
    delete process.env.LINE_CHANNEL_ID;
    expect(() => getLine()).toThrow(/LINE_CHANNEL_ID/);
  });

  it("real mode constructs when LINE_CHANNEL_ID is present", () => {
    process.env.LINE_PROVIDER = "line";
    process.env.LINE_CHANNEL_ID = "1234567890";
    expect(() => getLine()).not.toThrow();
  });
});
