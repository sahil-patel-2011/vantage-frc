import { describe, expect, it } from "vitest";
import { clampDiscordContent, isValidDiscordWebhook } from "./discord";

describe("isValidDiscordWebhook", () => {
  it("accepts real discord webhook URLs", () => {
    expect(isValidDiscordWebhook("https://discord.com/api/webhooks/123456789/abcDEF-_token")).toBe(true);
    expect(isValidDiscordWebhook("https://discordapp.com/api/webhooks/1/tok")).toBe(true);
    expect(isValidDiscordWebhook("https://discord.com/api/v10/webhooks/42/xyz")).toBe(true);
  });

  it("rejects non-discord and unsafe URLs", () => {
    expect(isValidDiscordWebhook("http://discord.com/api/webhooks/1/tok")).toBe(false); // not https
    expect(isValidDiscordWebhook("https://evil.com/api/webhooks/1/tok")).toBe(false); // wrong host
    expect(isValidDiscordWebhook("https://discord.com/users/1")).toBe(false); // wrong path
    expect(isValidDiscordWebhook("https://discord.com.evil.com/api/webhooks/1/t")).toBe(false); // host spoof
    expect(isValidDiscordWebhook("not a url")).toBe(false);
    expect(isValidDiscordWebhook("https://169.254.169.254/api/webhooks/1/t")).toBe(false); // SSRF target
  });
});

describe("clampDiscordContent", () => {
  it("trims and caps at 2000 chars", () => {
    expect(clampDiscordContent("  hi  ")).toBe("hi");
    const long = "a".repeat(2500);
    const out = clampDiscordContent(long);
    expect(out.length).toBe(2000);
    expect(out.endsWith("…")).toBe(true);
  });
});
