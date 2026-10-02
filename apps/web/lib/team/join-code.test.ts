import { afterEach, expect, it, vi } from "vitest";
import {
  decryptTeamPin,
  encryptTeamPin,
  newTeamPin,
  validTeamPin,
} from "./join-code";
afterEach(() => vi.unstubAllEnvs());
it("preserves six digits including leading zeroes and rejects other credentials", () => {
  expect(validTeamPin("001234")).toBe(true);
  for (const value of [123456, "12345", "1234567", " abcde", "123abc", null])
    expect(validTeamPin(value)).toBe(false);
  for (let i = 0; i < 100; i++) expect(newTeamPin()).toMatch(/^\d{6}$/);
});
it("encrypts manager-visible codes and detects tampering", () => {
  vi.stubEnv("BETTER_AUTH_SECRET", "join-code-unit-secret");
  const encrypted = encryptTeamPin("001234");
  expect(encrypted).not.toContain("001234");
  expect(decryptTeamPin(encrypted)).toBe("001234");
  const parts = encrypted.split(".");
  parts[1] = Buffer.alloc(16).toString("base64url");
  expect(() => decryptTeamPin(parts.join("."))).toThrow();
  vi.stubEnv("BETTER_AUTH_SECRET", "");
  expect(() => encryptTeamPin("001234")).toThrow(/authentication/);
});
