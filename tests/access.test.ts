import { describe, expect, it } from "vitest";
import { decideAccess, isReadOnlyAccess } from "../lib/access";

const now = new Date("2026-11-20T12:00:00Z");
const cache = (status: "active" | "revoked", checkedAt: string) => ({ email: "sam@gmail.com", status, checkedAt });

describe("decideAccess", () => {
  it("goes by the server's answer when there is one", () => {
    expect(decideAccess({ email: "sam@gmail.com", status: "active" }, null, now)).toEqual({ kind: "active", email: "sam@gmail.com" });
    expect(decideAccess({ email: "sam@gmail.com", status: "revoked" }, cache("active", "2026-11-19T00:00:00Z"), now).kind).toBe("revoked");
    expect(decideAccess("reauth", cache("active", "2026-11-19T00:00:00Z"), now).kind).toBe("reauth");
  });

  it("keeps working offline for 14 days on the last answer, then turns read-only", () => {
    expect(decideAccess("unreachable", cache("active", "2026-11-10T12:00:00Z"), now).kind).toBe("active");
    expect(decideAccess("unreachable", cache("active", "2026-11-01T12:00:00Z"), now).kind).toBe("offlineTooLong");
    expect(decideAccess("unreachable", cache("revoked", "2026-11-19T12:00:00Z"), now).kind).toBe("revoked");
    // Never checked yet (e.g. before the server is set up): let them in.
    expect(decideAccess("unreachable", null, now).kind).toBe("active");
  });

  it("read-only means revoked or offline too long", () => {
    expect(isReadOnlyAccess({ kind: "revoked", email: "" })).toBe(true);
    expect(isReadOnlyAccess({ kind: "offlineTooLong", email: "" })).toBe(true);
    expect(isReadOnlyAccess({ kind: "active", email: "" })).toBe(false);
  });
});
