import { describe, expect, it } from "vitest";
import { handoffTokenHash, isHandoffTokenShape, newHandoffToken } from "./handoff";

describe("handoff tokens", () => {
  it("mints 32 random bytes and stores only their sha256", () => {
    const a = newHandoffToken();
    const b = newHandoffToken();
    expect(a.token).not.toBe(b.token);
    expect(isHandoffTokenShape(a.token)).toBe(true);
    expect(a.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(a.hash).toBe(handoffTokenHash(a.token));
    expect(a.hash).not.toContain(a.token);
  });

  it("rejects anything that is not one of ours before touching the database", () => {
    expect(isHandoffTokenShape(null)).toBe(false);
    expect(isHandoffTokenShape("")).toBe(false);
    expect(isHandoffTokenShape("short")).toBe(false);
    expect(isHandoffTokenShape(`${"a".repeat(42)}=`)).toBe(false);
    expect(isHandoffTokenShape("' OR 1=1 --")).toBe(false);
  });
});
