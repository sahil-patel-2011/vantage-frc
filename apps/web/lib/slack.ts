import { createHmac, timingSafeEqual } from "node:crypto";

const SLACK_WEBHOOK_HOSTS = new Set(["hooks.slack.com"]);

export function isValidSlackWebhook(url: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url.trim());
  } catch {
    return false;
  }
  if (parsed.protocol !== "https:") return false;
  if (!SLACK_WEBHOOK_HOSTS.has(parsed.hostname)) return false;
  return /^\/services\/T[A-Z0-9]+\/B[A-Z0-9]+\/[A-Za-z0-9]+$/.test(parsed.pathname);
}

export function isValidSlackWorkspaceId(value: string): boolean {
  return /^T[A-Z0-9]{8,}$/.test(value.trim());
}

export function isValidSlackChannelId(value: string): boolean {
  return /^[CDG][A-Z0-9]{8,}$/.test(value.trim());
}

export function clampSlackText(content: string): string {
  const trimmed = content.trim();
  return trimmed.length > 3000 ? `${trimmed.slice(0, 2999)}…` : trimmed;
}

export function formatSlackBridgeMessage(input: {
  authorName: string;
  body: string;
  appHref?: string | null;
}): string {
  const author = input.authorName.trim() || "Teammate";
  const body = clampSlackText(input.body);
  const href = input.appHref?.trim();
  const lines = [`*${author}* (Vantage team chat)`, body];
  if (href) lines.push(`<${href}|Open in Vantage>`);
  return clampSlackText(lines.join("\n"));
}

export type SlackPostResult = { ok: boolean; status: number; error?: string; ts?: string | null };

export async function postToSlackWebhook(webhookUrl: string, text: string): Promise<SlackPostResult> {
  if (!isValidSlackWebhook(webhookUrl)) {
    return { ok: false, status: 0, error: "Not a valid Slack incoming webhook URL" };
  }
  const body = clampSlackText(text);
  if (!body) return { ok: false, status: 0, error: "Message is empty" };
  try {
    const response = await fetch(webhookUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text: body, username: "Vantage" }),
    });
    if (response.ok) return { ok: true, status: response.status };
    return { ok: false, status: response.status, error: `Slack returned ${response.status}` };
  } catch (error) {
    return { ok: false, status: 0, error: error instanceof Error ? error.message : "Network error" };
  }
}

export function slackSetupStatus(): { configured: boolean; message: string } {
  const signing = Boolean(process.env.SLACK_SIGNING_SECRET?.trim());
  if (signing) {
    return {
      configured: true,
      message: "Platform Slack signing secret is set. Teams still paste a channel webhook to post from Vantage.",
    };
  }
  return {
    configured: false,
    message:
      "Inbound Slack events need SLACK_SIGNING_SECRET (or a per-team signing secret). Outbound still works with a channel webhook.",
  };
}

export function verifySlackSignature(input: {
  signingSecret: string;
  timestamp: string;
  rawBody: string;
  signature: string;
  nowMs?: number;
}): boolean {
  const secret = input.signingSecret.trim();
  const timestamp = input.timestamp.trim();
  const signature = input.signature.trim();
  if (!secret || !/^\d+$/.test(timestamp) || !signature.startsWith("v0=")) return false;
  const now = input.nowMs ?? Date.now();
  const tsMs = Number(timestamp) * 1000;
  if (!Number.isFinite(tsMs) || Math.abs(now - tsMs) > 5 * 60 * 1000) return false;
  const base = `v0:${timestamp}:${input.rawBody}`;
  const digest = createHmac("sha256", secret).update(base).digest("hex");
  const expected = Buffer.from(`v0=${digest}`);
  const actual = Buffer.from(signature);
  if (expected.length !== actual.length) return false;
  return timingSafeEqual(expected, actual);
}

export function slackEventShouldIngest(event: {
  type?: string;
  subtype?: string;
  bot_id?: string;
  text?: string;
  channel_type?: string;
} | null | undefined): boolean {
  if (!event || event.type !== "message") return false;
  if (event.bot_id) return false;
  if (event.subtype) return false;
  if (!event.text?.trim()) return false;
  if (event.channel_type && event.channel_type !== "channel" && event.channel_type !== "group") {
    return false;
  }
  return true;
}
