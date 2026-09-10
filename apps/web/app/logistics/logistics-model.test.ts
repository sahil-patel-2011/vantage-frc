import { describe, expect, it } from "vitest";
import { canActOnline, fmtWhen, memberLabel } from "./logistics-model";

describe("logistics model helpers", () => {
  it("formats missing or invalid times without inventing a clock", () => {
    expect(fmtWhen(null)).toBe("—");
    expect(fmtWhen(undefined)).toBe("—");
    expect(fmtWhen("")).toBe("—");
    expect(fmtWhen("not-a-date")).toBe("not-a-date");
  });

  it("labels members from name, then email, then a short id", () => {
    expect(memberLabel({ userId: "abcdefghij", name: "  Alex  ", email: "a@x", role: "scout" })).toBe("Alex");
    expect(memberLabel({ userId: "abcdefghij", name: "  ", email: " a@x ", role: "scout" })).toBe("a@x");
    expect(memberLabel({ userId: "abcdefghij", name: null, email: null, role: "scout" })).toBe("abcdefgh");
  });

  it("blocks writes while offline or on a cached snapshot", () => {
    expect(canActOnline(true, false)).toBe(true);
    expect(canActOnline(false, false)).toBe(false);
    expect(canActOnline(true, true)).toBe(false);
  });
});
