import { describe, expect, it } from "vitest";
import {
  forgetAccountMemory,
  readRememberedInitial,
  readRememberedRoleCue,
  rememberInitial,
  rememberRoleCue,
} from "./shell-memory";

function memoryStorage() {
  const map = new Map<string, string>();
  return {
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => void map.set(key, value),
    removeItem: (key: string) => void map.delete(key),
  };
}

const TEAM = "6925a000-0000-4000-8000-000000000001";

describe("shell memory", () => {
  it("keeps the role per team and the avatar letter until sign-out", () => {
    const storage = memoryStorage();
    rememberRoleCue(storage, TEAM, "Owner");
    rememberInitial(storage, "S");
    expect(readRememberedRoleCue(storage, TEAM)).toBe("Owner");
    expect(readRememberedRoleCue(storage, "other")).toBeNull();
    expect(readRememberedInitial(storage)).toBe("S");
    forgetAccountMemory(storage);
    expect(readRememberedRoleCue(storage, TEAM)).toBeNull();
    expect(readRememberedInitial(storage)).toBeNull();
  });

  it("never keeps a placeholder letter", () => {
    const storage = memoryStorage();
    rememberInitial(storage, "?");
    expect(readRememberedInitial(storage)).toBeNull();
  });
});
