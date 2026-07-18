import { describe, expect, it } from "vitest";
import {
  clampDiscordContent,
  discordSetupStatus,
  formatDiscordAnnouncement,
  formatDiscordBridgeMessage,
  isDiscordBotConfigured,
  isDiscordObjectType,
  isValidDiscordSnowflake,
  isValidDiscordWebhook,
} from "./discord";

describe("isValidDiscordWebhook", () => {
  it("accepts real discord webhook URLs", () => {
    expect(isValidDiscordWebhook("https://discord.com/api/webhooks/123456789/abcDEF-_token")).toBe(true);
    expect(isValidDiscordWebhook("https://discordapp.com/api/webhooks/1/tok")).toBe(true);
  });

  it("rejects non-discord and unsafe URLs", () => {
    expect(isValidDiscordWebhook("http://discord.com/api/webhooks/1/tok")).toBe(false);
    expect(isValidDiscordWebhook("https://evil.com/api/webhooks/1/tok")).toBe(false);
    expect(isValidDiscordWebhook("https://169.254.169.254/api/webhooks/1/t")).toBe(false);
  });
});

describe("clampDiscordContent", () => {
  it("trims and caps at 2000 chars", () => {
    expect(clampDiscordContent("  hi  ")).toBe("hi");
    const out = clampDiscordContent("a".repeat(2500));
    expect(out.length).toBe(2000);
    expect(out.endsWith("…")).toBe(true);
  });
});

describe("discord setup status", () => {
  it("reports setup required when bot token is blank", () => {
    const status = discordSetupStatus({});
    expect(status.configured).toBe(false);
    expect(status.setupRequired).toBe(true);
    expect(isDiscordBotConfigured({})).toBe(false);
  });

  it("reads bot token and invite when present", () => {
    const status = discordSetupStatus({
      DISCORD_BOT_TOKEN: "bot.token",
      DISCORD_CLIENT_ID: "123456789012345678",
    });
    expect(status.setupRequired).toBe(false);
    expect(status.inviteUrl).toContain("client_id=123456789012345678");
  });
});

describe("snowflakes and formatting", () => {
  it("validates snowflakes and object types", () => {
    expect(isValidDiscordSnowflake("123456789012345678")).toBe(true);
    expect(isDiscordObjectType("task")).toBe(true);
    expect(isDiscordObjectType("widget")).toBe(false);
  });

  it("formats announcements and bridged messages", () => {
    expect(formatDiscordAnnouncement("Kickoff", "Be there")).toContain("**Kickoff**");
    expect(
      formatDiscordBridgeMessage({
        authorName: "Alex",
        body: "Need review",
        objectLink: { objectType: "cad_checkpoint", objectId: "1", label: "Intake v3" },
      }),
    ).toContain("CAD checkpoint");
  });
});
