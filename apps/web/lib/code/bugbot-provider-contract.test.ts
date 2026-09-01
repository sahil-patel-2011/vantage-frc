import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const WEB_ROOT = join(__dirname, "..", "..");
const ROUTE = readFileSync(join(WEB_ROOT, "app/api/code/route.ts"), "utf8");

/**
 * The resolveOrgChatAdapter* options object on the Bugbot path.
 * A future hosted-key shortcut for subscription has to break this extract first.
 */
function extractAdapterCall(source: string): string {
  const match = source.match(
    /resolveOrgChatAdapter(?:WithProvenance)?\(\s*client,\s*\{([\s\S]*?)\}\s*\)/,
  );
  expect(match, "Bugbot must resolve a chat adapter through resolveOrgChatAdapter*").toBeTruthy();
  return match![1]!;
}

/**
 * Provider contract for Bugbot.
 *
 * Subscription (`feature=coding`) is a normal resolveOrgChatAdapter* call with
 * preferPlatform off, so the resolver's default chain applies: member key →
 * team BYOK → local connector. Ultra (`feature=bugbot_ultra`) is the hosted
 * SKU and is the only Bugbot path that sets preferPlatform.
 *
 * The `coding` feature itself is never preferPlatform — that flag is Ultra-only.
 */
describe("Bugbot provider contract", () => {
  const adapterCall = extractAdapterCall(ROUTE);

  it("subscription Bugbot honors resolveOrgChatAdapter (member key → team BYOK → local connector)", () => {
    expect(ROUTE).toMatch(/resolveOrgChatAdapter(?:WithProvenance)?/);
    expect(adapterCall).toContain('feature: mode === "ultra" ? "bugbot_ultra" : "coding"');
    expect(adapterCall).toMatch(/preferPlatform:\s*mode === ["']ultra["']/);
    expect(adapterCall).not.toMatch(/preferPlatform:\s*true\b/);
  });

  it("Ultra uses preferPlatform and meters a hosted key", () => {
    expect(adapterCall).toContain('feature: mode === "ultra" ? "bugbot_ultra" : "coding"');
    expect(adapterCall).toMatch(/preferPlatform:\s*mode === ["']ultra["']/);
    expect(ROUTE).toContain('keySource: mode === "ultra" ? "platform" : undefined');
    expect(ROUTE).toContain('feature: mode === "ultra" ? "bugbot_ultra" : "coding"');
  });

  it("coding feature is not preferPlatform", () => {
    const featureAssignments = [...ROUTE.matchAll(/feature:\s*([^,\n]+)/g)].map((row) => row[1]!.trim());
    expect(featureAssignments.some((value) => value.includes('"coding"'))).toBe(true);
    expect(ROUTE).not.toMatch(/preferPlatform:\s*true\b/);
    expect(ROUTE).not.toMatch(/feature:\s*["']coding["'][\s\S]{0,80}preferPlatform:\s*true/);
    expect(ROUTE).not.toMatch(/preferPlatform:\s*true[\s\S]{0,80}feature:\s*["']coding["']/);

    const preferPlatform = adapterCall.match(/preferPlatform:\s*([^,\n]+)/)?.[1]?.trim();
    expect(preferPlatform).toBe('mode === "ultra"');
    expect(preferPlatform).not.toBe("true");
    expect(preferPlatform).not.toBe("false");
  });
});
