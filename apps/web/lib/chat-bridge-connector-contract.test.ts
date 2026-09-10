/**
 * Slack and Discord against mocked providers.
 *
 * Both are "paste a webhook" connectors, and both had the same class of bug as
 * the OAuth ones: the URL the provider needs from us was either absent
 * (Discord's is genuinely none, but nothing said so) or present in a form the
 * provider will not accept — the Slack page printed a RELATIVE Request URL,
 * `/api/integrations/slack/events`, which Slack's Event Subscriptions field
 * rejects. Inbound Slack could not be finished from what the product told you.
 */
import { createHmac } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  clampSlackText,
  formatSlackBridgeMessage,
  isValidSlackChannelId,
  isValidSlackWebhook,
  isValidSlackWorkspaceId,
  postToSlackWebhook,
  slackEventShouldIngest,
  slackEventsUrl,
  slackSetupStatus,
  verifySlackSignature,
} from "./slack";
import { discordSetupStatus, isValidDiscordWebhook, postToDiscord } from "./discord";

const WEBHOOK = "https://hooks.slack.com/services/T01234567/B01234567/abcdefghijklmnopqrstuvwx";
const DISCORD_WEBHOOK = "https://discord.com/api/webhooks/123456789012345678/abcDEF-ghi_jkl";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Slack Request URL is absolute and readable before setup", () => {
  it("is a full URL Slack will accept, not a path", () => {
    const url = slackEventsUrl({ BETTER_AUTH_URL: "https://vantage.example.com" });
    expect(url).toBe("https://vantage.example.com/api/integrations/slack/events");
    expect(url.startsWith("https://")).toBe(true);
  });

  it("is computed with no signing secret present — the setup case", () => {
    const status = slackSetupStatus({ BETTER_AUTH_URL: "https://vantage.example.com" });
    expect(status.configured).toBe(false);
    expect(status.eventsUrl).toBe("https://vantage.example.com/api/integrations/slack/events");
  });

  it("names the variable, where to set it, where to find it, and the URL", () => {
    const message = slackSetupStatus({ BETTER_AUTH_URL: "https://vantage.example.com" }).message;
    expect(message).toContain("SLACK_SIGNING_SECRET");
    expect(message).toContain("Environment Variables");
    expect(message).toContain("Basic Information");
    expect(message).toContain("https://vantage.example.com/api/integrations/slack/events");
  });

  it("says outbound already works, because it does — this is not a blocked connector", () => {
    expect(slackSetupStatus({}).message).toMatch(/outbound posting works today/i);
    expect(slackSetupStatus({}).missingEnv).toEqual(["SLACK_SIGNING_SECRET"]);
  });

  it("still shows the URL once configured, so a mismatch is visible", () => {
    const status = slackSetupStatus({
      BETTER_AUTH_URL: "https://vantage.example.com",
      SLACK_SIGNING_SECRET: "s",
    });
    expect(status.configured).toBe(true);
    expect(status.message).toContain("https://vantage.example.com/api/integrations/slack/events");
    expect(status.missingEnv).toEqual([]);
  });
});

describe("Slack webhook validation is an SSRF guard, not a formatting check", () => {
  it("accepts a real incoming webhook", () => {
    expect(isValidSlackWebhook(WEBHOOK)).toBe(true);
  });

  it("refuses another host, http, and an internal address", () => {
    expect(isValidSlackWebhook("https://evil.example.com/services/T1/B1/x")).toBe(false);
    expect(isValidSlackWebhook(WEBHOOK.replace("https:", "http:"))).toBe(false);
    expect(isValidSlackWebhook("https://169.254.169.254/services/T1/B1/x")).toBe(false);
    expect(isValidSlackWebhook("not a url")).toBe(false);
  });

  it("checks the id shapes a person is most likely to paste wrong", () => {
    expect(isValidSlackWorkspaceId("T012ABCDEF")).toBe(true);
    expect(isValidSlackWorkspaceId("C012ABCDEF")).toBe(false);
    expect(isValidSlackChannelId("C012ABCDEF")).toBe(true);
    expect(isValidSlackChannelId("T012ABCDEF")).toBe(false);
  });
});

describe("posting to a mocked Slack", () => {
  it("posts JSON to the saved webhook and reports success", async () => {
    const calls: Array<{ url: string; body: string }> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init: RequestInit) => {
        calls.push({ url: String(url), body: String(init.body) });
        return new Response("ok", { status: 200 });
      }),
    );
    const result = await postToSlackWebhook(WEBHOOK, "hello");
    expect(result.ok).toBe(true);
    expect(calls[0]!.url).toBe(WEBHOOK);
    expect(JSON.parse(calls[0]!.body)).toMatchObject({ text: "hello", username: "Vantage" });
  });

  it("refuses to send anywhere but Slack, without opening a socket", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const result = await postToSlackWebhook("https://evil.example.com/hook", "hello");
    expect(result.ok).toBe(false);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("reports a revoked webhook as a failure rather than throwing", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("no_service", { status: 404 })));
    const result = await postToSlackWebhook(WEBHOOK, "hello");
    expect(result.ok).toBe(false);
    expect(result.status).toBe(404);
  });

  it("clamps to Slack's limit instead of being rejected for length", () => {
    expect(clampSlackText("x".repeat(4000)).length).toBe(3000);
    expect(formatSlackBridgeMessage({ authorName: "Jane", body: "hi", appHref: "https://v/x" })).toContain(
      "<https://v/x|Open in Vantage>",
    );
  });
});

describe("Slack inbound signature", () => {
  const secret = "signing-secret";
  const timestamp = String(Math.floor(Date.now() / 1000));
  const rawBody = '{"type":"event_callback"}';

  function sign(body: string, ts: string, withSecret = secret) {
    return `v0=${createHmac("sha256", withSecret).update(`v0:${ts}:${body}`).digest("hex")}`;
  }

  it("accepts a correctly signed request", () => {
    expect(
      verifySlackSignature({ signingSecret: secret, timestamp, rawBody, signature: sign(rawBody, timestamp) }),
    ).toBe(true);
  });

  it("rejects a body that was changed after signing", () => {
    expect(
      verifySlackSignature({
        signingSecret: secret,
        timestamp,
        rawBody: '{"type":"evil"}',
        signature: sign(rawBody, timestamp),
      }),
    ).toBe(false);
  });

  it("rejects a signature made with a different secret", () => {
    expect(
      verifySlackSignature({
        signingSecret: secret,
        timestamp,
        rawBody,
        signature: sign(rawBody, timestamp, "other"),
      }),
    ).toBe(false);
  });

  it("rejects a replayed request older than five minutes", () => {
    const old = String(Math.floor(Date.now() / 1000) - 6 * 60);
    expect(
      verifySlackSignature({ signingSecret: secret, timestamp: old, rawBody, signature: sign(rawBody, old) }),
    ).toBe(false);
  });

  it("rejects an empty secret rather than validating against nothing", () => {
    expect(
      verifySlackSignature({ signingSecret: "  ", timestamp, rawBody, signature: sign(rawBody, timestamp) }),
    ).toBe(false);
  });

  it("ignores Vantage's own posts so the bridge cannot loop", () => {
    expect(slackEventShouldIngest({ type: "message", text: "hi", bot_id: "B1" })).toBe(false);
    expect(slackEventShouldIngest({ type: "message", text: "hi", subtype: "message_changed" })).toBe(false);
    expect(slackEventShouldIngest({ type: "message", text: "hi", channel_type: "channel" })).toBe(true);
  });
});

describe("Discord says which path needs a deployment variable and which does not", () => {
  it("does not present the webhook path as blocked on an admin", () => {
    const message = discordSetupStatus({}).message;
    expect(message).toMatch(/needs nothing from the deployment/i);
    expect(message).toContain("Server Settings → Integrations → Webhooks");
  });

  it("names DISCORD_BOT_TOKEN, where it is set and where it comes from, for the bot path", () => {
    const message = discordSetupStatus({}).message;
    expect(message).toContain("DISCORD_BOT_TOKEN");
    expect(message).toContain("DISCORD_CLIENT_ID");
    expect(message).toContain("Environment Variables");
    expect(message).toContain("discord.com/developers/applications");
  });

  it("says explicitly that Discord needs no callback URL", () => {
    expect(discordSetupStatus({}).message).toMatch(/no callback URL/i);
  });

  it("offers the bot invite link only when the client id can build a real one", () => {
    expect(discordSetupStatus({ DISCORD_BOT_TOKEN: "t" }).inviteUrl).toBeNull();
    const invite = discordSetupStatus({ DISCORD_BOT_TOKEN: "t", DISCORD_CLIENT_ID: "123456789012345678" }).inviteUrl;
    expect(invite).toContain("client_id=123456789012345678");
  });

  it("still reports configured only from the token", () => {
    expect(discordSetupStatus({}).configured).toBe(false);
    expect(discordSetupStatus({ DISCORD_BOT_TOKEN: "t" }).configured).toBe(true);
  });
});

describe("Discord webhook validation", () => {
  it("accepts the real hosts and rejects everything else", () => {
    expect(isValidDiscordWebhook(DISCORD_WEBHOOK)).toBe(true);
    expect(isValidDiscordWebhook(DISCORD_WEBHOOK.replace("discord.com", "discordapp.com"))).toBe(true);
    expect(isValidDiscordWebhook("https://evil.example.com/api/webhooks/1/x")).toBe(false);
    expect(isValidDiscordWebhook("http://discord.com/api/webhooks/1/x")).toBe(false);
  });

  it("never opens a socket for a rejected URL", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const result = await postToDiscord("https://evil.example.com/api/webhooks/1/x", "hi");
    expect(result.ok).toBe(false);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("suppresses mentions so a bridged message cannot ping @everyone", async () => {
    const bodies: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init: RequestInit) => {
        bodies.push(String(init.body));
        return new Response("", { status: 204 });
      }),
    );
    await postToDiscord(DISCORD_WEBHOOK, "@everyone hello");
    expect(JSON.parse(bodies[0]!)).toMatchObject({ allowed_mentions: { parse: [] } });
  });

  it("reports a deleted webhook as a failure rather than throwing", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("Unknown Webhook", { status: 404 })));
    const result = await postToDiscord(DISCORD_WEBHOOK, "hi");
    expect(result.ok).toBe(false);
    expect(result.status).toBe(404);
  });
});
