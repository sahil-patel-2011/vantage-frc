import { describe, expect, it } from "vitest";
import {
  EMPTY_REMEMBERED_ACCOUNT,
  LAST_EMAIL_STORAGE_KEY,
  LAST_METHOD_STORAGE_KEY,
  clearRememberedAccount,
  preferredSignInMethod,
  readRememberedAccount,
  writeRememberedAccount,
  type StorageLike,
} from "./remembered-account";

function memoryStore(seed: Record<string, string> = {}): StorageLike & { map: Map<string, string> } {
  const map = new Map(Object.entries(seed));
  return {
    map,
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => void map.set(key, value),
    removeItem: (key) => void map.delete(key),
  };
}

function throwingStore(): StorageLike {
  return {
    getItem() {
      throw new Error("SecurityError: storage is disabled");
    },
    setItem() {
      throw new Error("SecurityError: storage is disabled");
    },
    removeItem() {
      throw new Error("SecurityError: storage is disabled");
    },
  };
}

describe("remembered sign-in account", () => {
  it("round-trips the address and the method that worked", () => {
    const store = memoryStore();
    writeRememberedAccount(store, { email: " Scout@Team254.org ", method: "email" });
    expect(store.map.get(LAST_EMAIL_STORAGE_KEY)).toBe("scout@team254.org");
    expect(store.map.get(LAST_METHOD_STORAGE_KEY)).toBe("email");
    expect(readRememberedAccount(store)).toEqual({ email: "scout@team254.org", method: "email" });
  });

  it("never stores a code, a token, or anything session-shaped", () => {
    const store = memoryStore();
    writeRememberedAccount(store, { email: "scout@team254.org", method: "google" });
    expect([...store.map.keys()]).toEqual([LAST_EMAIL_STORAGE_KEY, LAST_METHOD_STORAGE_KEY]);
  });

  it("treats junk in storage as nothing rather than prefilling it", () => {
    const store = memoryStore({
      [LAST_EMAIL_STORAGE_KEY]: "not-an-email",
      [LAST_METHOD_STORAGE_KEY]: "sms",
    });
    expect(readRememberedAccount(store)).toEqual(EMPTY_REMEMBERED_ACCOUNT);
  });

  it("clears both keys, and survives storage being unavailable", () => {
    const store = memoryStore({
      [LAST_EMAIL_STORAGE_KEY]: "scout@team254.org",
      [LAST_METHOD_STORAGE_KEY]: "email",
    });
    clearRememberedAccount(store);
    expect(store.map.size).toBe(0);

    // Private mode / disabled storage — remembering is a convenience, not a requirement.
    expect(readRememberedAccount(throwingStore())).toEqual(EMPTY_REMEMBERED_ACCOUNT);
    expect(() => writeRememberedAccount(throwingStore(), { email: "a@b.co" })).not.toThrow();
    expect(() => clearRememberedAccount(throwingStore())).not.toThrow();
    expect(readRememberedAccount(null)).toEqual(EMPTY_REMEMBERED_ACCOUNT);
  });

  it("preselects the method that worked last time — while it is still configured", () => {
    expect(
      preferredSignInMethod({ email: null, method: "google" }, { google: true, email: true }),
    ).toBe("google");
    // Google lost its credentials since the last visit: never preselect a dead end.
    expect(
      preferredSignInMethod({ email: null, method: "google" }, { google: false, email: true }),
    ).toBe("email");
    expect(
      preferredSignInMethod({ email: null, method: "email" }, { google: true, email: true }),
    ).toBe("email");
    expect(preferredSignInMethod(EMPTY_REMEMBERED_ACCOUNT, { google: true, email: true })).toBe("email");
    expect(preferredSignInMethod(EMPTY_REMEMBERED_ACCOUNT, { google: true, email: false })).toBe("google");
  });
});
