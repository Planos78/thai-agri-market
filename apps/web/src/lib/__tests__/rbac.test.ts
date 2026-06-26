import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextResponse } from "next/server";

const verifyAdminJwt = vi.fn();
const bearer = vi.fn();
vi.mock("@/lib/auth", () => ({
  verifyAdminJwt: (...a: unknown[]) => verifyAdminJwt(...a),
  bearer: (...a: unknown[]) => bearer(...a),
}));

const findMany = vi.fn();
vi.mock("@/lib/db", () => ({
  prisma: { userOrchardScope: { findMany: (...a: unknown[]) => findMany(...a) } },
}));

import { requirePerm, scopedOrchardIds, inScope } from "@/lib/rbac";

const req = new Request("http://x");

beforeEach(() => {
  verifyAdminJwt.mockReset();
  bearer.mockReset();
  findMany.mockReset();
});

describe("requirePerm", () => {
  it("no token -> 401", async () => {
    bearer.mockReturnValue(null);
    verifyAdminJwt.mockResolvedValue(null);
    const res = await requirePerm(req, "lots.read");
    expect(res).toBeInstanceOf(NextResponse);
    expect((res as NextResponse).status).toBe(401);
  });

  it("valid token missing perm -> 403", async () => {
    bearer.mockReturnValue("t");
    verifyAdminJwt.mockResolvedValue({ sub: "u1", email: "a@b", perms: ["orders.read"] });
    const res = await requirePerm(req, "lots.read");
    expect(res).toBeInstanceOf(NextResponse);
    expect((res as NextResponse).status).toBe(403);
  });

  it("valid token with perm -> returns claims", async () => {
    bearer.mockReturnValue("t");
    const claims = { sub: "u1", email: "a@b", perms: ["lots.read"] };
    verifyAdminJwt.mockResolvedValue(claims);
    const res = await requirePerm(req, "lots.read");
    expect(res).toEqual(claims);
  });
});

describe("scopedOrchardIds", () => {
  const claims = { sub: "u1", email: "a@b", perms: [] };
  it("0 rows -> ALL", async () => {
    findMany.mockResolvedValue([]);
    expect(await scopedOrchardIds(claims)).toBe("ALL");
  });
  it("N rows -> ids", async () => {
    findMany.mockResolvedValue([{ orchardId: "o1" }, { orchardId: "o2" }]);
    expect(await scopedOrchardIds(claims)).toEqual(["o1", "o2"]);
  });
});

describe("inScope", () => {
  it("ALL -> true", () => expect(inScope("ALL", "o1")).toBe(true));
  it("member -> true", () => expect(inScope(["o1", "o2"], "o1")).toBe(true));
  it("non-member -> false", () => expect(inScope(["o1"], "o2")).toBe(false));
});
