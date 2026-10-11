/**
 * QA A1-09, A1-13, A1-14, A1-15: what sign-in keeps on a shared device, and what the email field
 * says before the button can be pressed.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { DEFAULT_CODE_TTL_SECONDS, OTP_ALLOWED_ATTEMPTS, emailEntryHint, isLikelyEmail } from "./otp-code";
import { PENDING_CODE_STORAGE_KEY, readPendingCode, writePendingCode } from "./pending-code";
import { LAST_EMAIL_STORAGE_KEY, LAST_METHOD_STORAGE_KEY } from "./remembered-account";
import { forgetEntryTraces } from "../sign-out";
import { onboardingAnswersKey } from "../onboarding/entry-journey";

class MemoryStorage {
  private map = new Map<string, string>();
  get length() { return this.map.size; }
  key(index: number) { return [...this.map.keys()][index] ?? null; }
  getItem(key: string) { return this.map.get(key) ?? null; }
  setItem(key: string, value: string) { this.map.set(key, String(value)); }
  removeItem(key: string) { this.map.delete(key); }
  clear() { this.map.clear(); }
}

const NOW = 1_800_000_000_000;

describe("the email field's own check (A1-13, A1-14)", () => {
  it("refuses what the browser refuses, and says why", () => {
    for (const address of ["jöse@exämple.test", "用户@例子.测试", "😀@example.test"]) {
      expect(isLikelyEmail(address), address).toBe(false);
      expect(emailEntryHint(address), address).toMatch(/characters we can't send to/);
    }
  });

  it("says a too-long address is too long, not unfinished", () => {
    const long = `${"a".repeat(300)}@example.test`;
    expect(isLikelyEmail(long)).toBe(false);
    expect(emailEntryHint(long)).toMatch(/longer than 254 characters/);
  });

  it("keeps the old hint for an unfinished address, and none for a good one", () => {
    expect(emailEntryHint("mentor@example")).toMatch(/Finish the address/);
    expect(emailEntryHint("mentor@example.org")).toBeNull();
    expect(emailEntryHint("  OWNER@Example.TEST ")).toBeNull();
  });
});

describe("tries per code match the server (A1-12)", () => {
  it("uses the same number as OTP_POLICY.allowedAttempts", () => {
    const core = readFileSync(join(__dirname, "..", "..", "..", "..", "packages", "core", "src", "index.ts"), "utf8");
    const allowed = Number(/allowedAttempts:\s*(\d+)/.exec(core)?.[1]);
    expect(allowed).toBe(OTP_ALLOWED_ATTEMPTS);
  });
});

describe("the code step survives a reload in this tab (A1-15)", () => {
  it("restores a live code step and forgets an expired or tampered one", () => {
    const store = new MemoryStorage();
    writePendingCode(store, { email: "scout@example.com", codeExpiresAt: NOW + 200_000, resendAvailableAt: NOW + 10_000 });
    expect(readPendingCode(store, NOW)).toEqual({ email: "scout@example.com", codeExpiresAt: NOW + 200_000, resendAvailableAt: NOW + 10_000 });
    expect(readPendingCode(store, NOW + 200_001)).toBeNull();
    expect(store.getItem(PENDING_CODE_STORAGE_KEY)).toBeNull();

    writePendingCode(store, { email: "scout@example.com", codeExpiresAt: NOW + DEFAULT_CODE_TTL_SECONDS * 1_000 * 10, resendAvailableAt: null });
    expect(readPendingCode(store, NOW)).toBeNull();
    store.setItem(PENDING_CODE_STORAGE_KEY, "{not json");
    expect(readPendingCode(store, NOW)).toBeNull();
    writePendingCode(store, { email: "not an address", codeExpiresAt: NOW + 100_000, resendAvailableAt: null });
    expect(readPendingCode(store, NOW)).toBeNull();
  });

  it("never keeps the code itself", () => {
    const source = readFileSync(join(__dirname, "pending-code.ts"), "utf8");
    expect(source).not.toMatch(/code:\s*string/);
  });
});

describe("signing out on a shared laptop (A1-09)", () => {
  const original = (globalThis as { window?: unknown }).window;
  afterEach(() => {
    (globalThis as { window?: unknown }).window = original;
  });

  it("forgets the remembered address, a kept code step and unsaved onboarding answers", () => {
    const local = new MemoryStorage();
    const session = new MemoryStorage();
    (globalThis as { window?: unknown }).window = { localStorage: local, sessionStorage: session };
    local.setItem(LAST_EMAIL_STORAGE_KEY, "student@school.org");
    local.setItem(LAST_METHOD_STORAGE_KEY, "email");
    local.setItem(onboardingAnswersKey("user-1", "org-1")!, JSON.stringify({ firstName: "Avery" }));
    session.setItem(onboardingAnswersKey("user-1", null)!, JSON.stringify({ firstName: "Avery" }));
    session.setItem(PENDING_CODE_STORAGE_KEY, JSON.stringify({ email: "student@school.org", codeExpiresAt: NOW }));
    local.setItem("vantage-theme-pref", "dark");

    forgetEntryTraces();

    expect(local.getItem(LAST_EMAIL_STORAGE_KEY)).toBeNull();
    expect(local.getItem(LAST_METHOD_STORAGE_KEY)).toBeNull();
    expect(local.getItem(onboardingAnswersKey("user-1", "org-1")!)).toBeNull();
    expect(session.getItem(onboardingAnswersKey("user-1", null)!)).toBeNull();
    expect(session.getItem(PENDING_CODE_STORAGE_KEY)).toBeNull();
    // A device setting is not about the person.
    expect(local.getItem("vantage-theme-pref")).toBe("dark");
  });

  it("is part of signing out, and the address is remembered only after a sign-in works", () => {
    const signOut = readFileSync(join(__dirname, "..", "sign-out.ts"), "utf8");
    expect(signOut).toMatch(/forgetEntryTraces\(\);/);
    const client = readFileSync(join(__dirname, "..", "..", "app", "sign-in", "sign-in-client.tsx"), "utf8");
    const send = /const sendFirstFactorCode = useCallback\([\s\S]*?\n {2}\);/.exec(client)?.[0] ?? "";
    expect(send).not.toMatch(/writeRememberedAccount/);
    const verify = /const verifyCode = useCallback\([\s\S]*?\n {2}\}, \[flow, leave\]\);/.exec(client)?.[0] ?? "";
    expect(verify).toMatch(/writeRememberedAccount/);
  });
});
