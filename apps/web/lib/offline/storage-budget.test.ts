import { afterEach, describe, expect, it, vi } from "vitest";
import { cacheAllowance, checkCacheSpace, GB, parseOfflineBudget, readOfflineBudget, saveOfflineBudget } from "./storage-budget";

afterEach(() => vi.unstubAllGlobals());
describe("offline cache budget", () => {
  it("accepts whole GB in range and safely defaults corrupt preferences", () => {
    for (let n = 2; n <= 20; n++) expect(parseOfflineBudget(String(n))).toBe(n);
    for (const value of [null, undefined, {}, true, "bad", 1, 21, 3.5, Infinity]) expect(parseOfflineBudget(value)).toBe(2);
  });
  it("persists only valid choices and reports blocked storage instead of pretending to save", () => {
    const values = new Map();
    vi.stubGlobal("localStorage", { getItem: (key: string) => values.get(key), setItem: (key: string, value: string) => values.set(key, value) });
    saveOfflineBudget(20);
    expect(readOfflineBudget()).toBe(20);
    expect(() => saveOfflineBudget(21)).toThrow();
    expect(readOfflineBudget()).toBe(20);
    vi.stubGlobal("localStorage", { getItem: () => { throw new Error(); }, setItem: () => { throw new Error(); } });
    expect(readOfflineBudget()).toBe(2);
    expect(() => saveOfflineBudget(4)).toThrow();
  });
  it("respects a smaller browser allowance and keeps headroom", async () => {
    expect(cacheAllowance(20, GB)).toBe(GB * 0.9);
    expect(cacheAllowance(2, 30 * GB)).toBe(2 * GB);
    vi.stubGlobal("navigator", { storage: { estimate: async () => ({ usage: GB * 0.8, quota: GB }) } });
    await expect(checkCacheSpace(GB / 20)).resolves.toBeUndefined();
    await expect(checkCacheSpace(GB / 5)).rejects.toThrow("Unsent work is kept");
  });
  it("handles browsers without estimates, zero quota, and temporary estimate failure", async () => {
    vi.stubGlobal("navigator", {});
    await expect(checkCacheSpace(10)).resolves.toBeUndefined();
    vi.stubGlobal("navigator", { storage: { estimate: async () => ({ quota: 0 }) } });
    await expect(checkCacheSpace(10)).rejects.toThrow("limit reached");
    vi.stubGlobal("navigator", { storage: { estimate: async () => { throw new Error(); } } });
    await expect(checkCacheSpace(10)).resolves.toBeUndefined();
  });
});
