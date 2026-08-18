import { describe, expect, it } from "vitest";
import { createHmac } from "node:crypto";
import {
  clampSlackText,
  formatSlackBridgeMessage,
  isValidSlackChannelId,
  isValidSlackWebhook,
  isValidSlackWorkspaceId,
  slackEventShouldIngest,
  verifySlackSignature,
} from "./slack";

function sign(secret: string, timestamp: string, body: string) {
  const digest = createHmac("sha256", secret).update(`v0:${timestamp}:${body}`).digest("hex");
  return `v0=${digest}`;
}

describe("Slack webhook guards", () => {
  it("accepts only https hooks.slack.com incoming webhooks", () => {
    expect(isValidSlackWebhook("https://hooks.slack.com/services/T00000000/B00000000/XXXXXXXXXXXXXXXXXXXXXXXX")).toBe(
      true,
    );
    expect(isValidSlackWebhook("https://evil.example/services/T00000000/B00000000/XXXXXXXXXXXXXXXXXXXXXXXX")).toBe(
      false,
    );
    expect(isValidSlackWebhook("http://hooks.slack.com/services/T00000000/B00000000/XXXXXXXXXXXXXXXXXXXXXXXX")).toBe(
      false,
    );
  });

  it("validates workspace and channel ids", () => {
    expect(isValidSlackWorkspaceId("T012ABCDEF")).toBe(true);
    expect(isValidSlackChannelId("C012ABCDEF")).toBe(true);
    expect(isValidSlackChannelId("D012ABCDEF")).toBe(true);
    expect(isValidSlackWorkspaceId("not-slack")).toBe(false);
  });
});

describe("Slack signing and ingest filters", () => {
  it("accepts a fresh v0 signature", () => {
    const timestamp = String(Math.floor(Date.now() / 1000));
    const rawBody = '{"type":"event_callback"}';
    expect(
      verifySlackSignature({
        signingSecret: "secret",
        timestamp,
        rawBody,
        signature: sign("secret", timestamp, rawBody),
      }),
    ).toBe(true);
    expect(
      verifySlackSignature({
        signingSecret: "secret",
        timestamp,
        rawBody,
        signature: sign("other", timestamp, rawBody),
      }),
    ).toBe(false);
  });

  it("skips bots, subtypes, and empty text", () => {
    expect(slackEventShouldIngest({ type: "message", text: "hello", channel_type: "channel" })).toBe(true);
    expect(slackEventShouldIngest({ type: "message", text: "hello", bot_id: "B1" })).toBe(false);
    expect(slackEventShouldIngest({ type: "message", text: "hello", subtype: "message_changed" })).toBe(false);
    expect(slackEventShouldIngest({ type: "message", text: "   " })).toBe(false);
  });

  it("formats a Vantage→Slack body without inventing DEMO copy", () => {
    const text = formatSlackBridgeMessage({
      authorName: "Alex",
      body: "Pit is ready",
      appHref: "https://vantagefrc.com/team?tab=messages",
    });
    expect(text).toContain("Alex");
    expect(text).toContain("Pit is ready");
    expect(text).not.toMatch(/\bdemo\b/i);
    expect(clampSlackText("x".repeat(3010)).endsWith("…")).toBe(true);
  });
});
