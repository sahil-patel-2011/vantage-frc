import { describe, expect, it } from "vitest";
import {
  DISCORD_RELATED_INCLUDE,
  canPostViaDiscord,
  discordNextActions,
  discordRelatedLinks,
  formatBridgePostCount,
} from "./discord-related";

describe("discord Soft-UI helpers", () => {
  it("builds Messages / Team cross-links", () => {
    const links = discordRelatedLinks("org-1", { include: [...DISCORD_RELATED_INCLUDE] });
    expect(links.map((l) => l.id)).toEqual(["messages", "team", "alumni"]);
    expect(links.find((l) => l.id === "messages")?.href).toBe("/team?tab=messages&orgId=org-1");
    expect(links.find((l) => l.id === "team")?.href).toBe("/team?orgId=org-1");
    expect(links.every((l) => !/demo/i.test(l.label))).toBe(true);
  });

  it("requires webhook or bot+channel before posting", () => {
    expect(canPostViaDiscord({ hasWebhook: true, channelId: null, platformConfigured: false })).toBe(true);
    expect(
      canPostViaDiscord({ hasWebhook: false, channelId: "123456789012345678", platformConfigured: true }),
    ).toBe(true);
    expect(canPostViaDiscord({ hasWebhook: false, channelId: "123", platformConfigured: false })).toBe(false);
    expect(canPostViaDiscord({ hasWebhook: false, channelId: null, platformConfigured: true })).toBe(false);
  });

  it("requires workspace before next actions", () => {
    expect(discordNextActions({}).map((a) => a.id)).toEqual(["workspace"]);
  });

  it("asks to connect when empty — never DEMO sync stats", () => {
    const actions = discordNextActions({ orgId: "org-1", configured: false });
    expect(actions[0]?.id).toBe("connect");
    expect(actions[0]?.primary).toBe(true);
    expect(actions.map((a) => a.id)).toContain("messages");
    expect(actions.map((a) => a.id)).toContain("team");
    expect(actions.every((a) => !/demo/i.test(`${a.label} ${a.detail}`))).toBe(true);
  });

  it("flags setup_required posting path when no webhook or token path", () => {
    const actions = discordNextActions({
      orgId: "org-1",
      configured: true,
      hasWebhook: false,
      channelId: "123456789012345678",
      platformConfigured: false,
    });
    expect(actions[0]?.id).toBe("posting-path");
  });

  it("nudges enabling the object-linked bridge when connected", () => {
    const actions = discordNextActions({
      orgId: "org-1",
      configured: true,
      hasWebhook: true,
      platformConfigured: true,
      chatBridgeEnabled: false,
    });
    expect(actions[0]?.id).toBe("enable-bridge");
  });

  it("formats bridge counts blank until real posts exist", () => {
    expect(formatBridgePostCount(null)).toBe("—");
    expect(formatBridgePostCount(undefined)).toBe("—");
    expect(formatBridgePostCount(0)).toBe("0");
    expect(formatBridgePostCount(3)).toBe("3");
  });
});
