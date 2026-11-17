// Minimal Discord webhook integration for the team alumni network. Teams paste a
// channel webhook URL (Server Settings → Integrations → Webhooks) and the app can
// post announcements to it. We validate the host so a stored URL can only ever be
// a real Discord webhook — never an arbitrary internal address (SSRF guard).

const DISCORD_WEBHOOK_HOSTS = new Set(["discord.com", "discordapp.com", "ptb.discord.com", "canary.discord.com"]);

export function isValidDiscordWebhook(url: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url.trim());
  } catch {
    return false;
  }
  if (parsed.protocol !== "https:") return false;
  if (!DISCORD_WEBHOOK_HOSTS.has(parsed.hostname)) return false;
  // Path shape: /api/webhooks/<id>/<token> (optionally /api/v<n>/webhooks/...)
  return /^\/api\/(v\d+\/)?webhooks\/\d+\/[\w-]+$/.test(parsed.pathname);
}

// A Discord webhook accepts up to 2000 chars of content per message.
export function clampDiscordContent(content: string): string {
  const trimmed = content.trim();
  return trimmed.length > 2000 ? `${trimmed.slice(0, 1999)}…` : trimmed;
}

export type DiscordPostResult = { ok: boolean; status: number; error?: string; messageId?: string | null };

export async function postToDiscord(webhookUrl: string, content: string): Promise<DiscordPostResult> {
  if (!isValidDiscordWebhook(webhookUrl)) {
    return { ok: false, status: 0, error: "Not a valid Discord webhook URL" };
  }
  const body = clampDiscordContent(content);
  if (!body) return { ok: false, status: 0, error: "Message is empty" };
  try {
    const response = await fetch(webhookUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ content: body, allowed_mentions: { parse: [] } }),
    });
    if (response.ok) return { ok: true, status: response.status };
    return { ok: false, status: response.status, error: `Discord returned ${response.status}` };
  } catch (error) {
    return { ok: false, status: 0, error: error instanceof Error ? error.message : "Network error" };
  }
}

// --- Object-linked chat bridge (CD #50) -------------------------------------

export const DISCORD_OBJECT_TYPES = [
  "task",
  "cad_checkpoint",
  "inventory_item",
  "announcement",
  "event",
  "goal",
  "risk",
  "knowledge",
] as const;

export type DiscordObjectType = (typeof DISCORD_OBJECT_TYPES)[number];

export type DiscordObjectLink = {
  objectType: DiscordObjectType;
  objectId: string;
  label: string;
  href?: string | null;
};

const OBJECT_TYPE_LABELS: Record<DiscordObjectType, string> = {
  task: "Task",
  cad_checkpoint: "CAD checkpoint",
  inventory_item: "Inventory item",
  announcement: "Announcement",
  event: "Event",
  goal: "Goal",
  risk: "Risk",
  knowledge: "Knowledge",
};

export function isDiscordObjectType(value: string): value is DiscordObjectType {
  return (DISCORD_OBJECT_TYPES as readonly string[]).includes(value);
}

/** Discord snowflakes are 17–20 digit numeric strings. */
export function isValidDiscordSnowflake(value: string): boolean {
  return /^\d{17,20}$/.test(value.trim());
}

export type DiscordSetupStatus = {
  configured: boolean;
  setupRequired: boolean;
  inviteUrl: string | null;
  message: string;
};

export function isDiscordBotConfigured(env: Record<string, string | undefined> = process.env): boolean {
  return Boolean(env.DISCORD_BOT_TOKEN?.trim());
}

export function discordSetupStatus(env: Record<string, string | undefined> = process.env): DiscordSetupStatus {
  const token = env.DISCORD_BOT_TOKEN?.trim();
  const clientId = env.DISCORD_CLIENT_ID?.trim();
  const configured = Boolean(token);
  const inviteUrl =
    clientId && isValidDiscordSnowflake(clientId)
      ? `https://discord.com/api/oauth2/authorize?client_id=${clientId}&permissions=2048&scope=bot%20applications.commands`
      : null;
  return {
    configured,
    setupRequired: !configured,
    inviteUrl,
    // Two independent paths post to Discord and only one needs a deployment
    // variable. Saying "Set DISCORD_BOT_TOKEN" alone reads as "this connector
    // is blocked until an admin acts", which is false — a channel webhook is
    // pasted by the team and needs nothing from the deployment at all.
    message: configured
      ? "Discord bot token is configured, so bot posts work once a team saves a channel id. A channel webhook still posts without it."
      : "Webhook posting needs nothing from the deployment: create one in Discord → Server Settings → Integrations → Webhooks and paste it below. Bot posts (which need a channel id instead of a webhook) additionally need DISCORD_BOT_TOKEN — and DISCORD_CLIENT_ID for the invite link — set in your deployment environment (Vercel → Project → Settings → Environment Variables), from discord.com/developers/applications → your app → Bot. Discord needs no callback URL from Vantage.",
  };
}

export function formatDiscordAnnouncement(title: string, message: string): string {
  const safeTitle = title.trim() || "Announcement";
  return clampDiscordContent(`📢 **${safeTitle}**\n${message.trim()}`);
}

export function formatDiscordBridgeMessage(input: {
  authorName: string;
  body: string;
  objectLink?: DiscordObjectLink | null;
  appHref?: string | null;
}): string {
  const lines = [`**${input.authorName.trim() || "Teammate"}**`, input.body.trim()];
  if (input.objectLink) {
    const kind = OBJECT_TYPE_LABELS[input.objectLink.objectType] ?? input.objectLink.objectType;
    lines.push(`🔗 ${kind}: **${input.objectLink.label.trim()}**`);
    const deepLink = input.objectLink.href?.trim() || input.appHref?.trim();
    if (deepLink) lines.push(deepLink);
  } else if (input.appHref?.trim()) {
    lines.push(input.appHref.trim());
  }
  return clampDiscordContent(lines.join("\n"));
}

async function postViaDiscordBot(channelId: string, content: string): Promise<DiscordPostResult> {
  const token = process.env.DISCORD_BOT_TOKEN?.trim();
  if (!token) return { ok: false, status: 0, error: "Discord bot token is not configured" };
  if (!isValidDiscordSnowflake(channelId)) {
    return { ok: false, status: 0, error: "Channel id must be a Discord snowflake" };
  }
  const body = clampDiscordContent(content);
  if (!body) return { ok: false, status: 0, error: "Message is empty" };
  try {
    const response = await fetch(`https://discord.com/api/v10/channels/${channelId}/messages`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bot ${token}`,
      },
      body: JSON.stringify({ content: body, allowed_mentions: { parse: [] } }),
    });
    if (response.ok) {
      const payload = (await response.json()) as { id?: string };
      return { ok: true, status: response.status, messageId: payload.id ?? null };
    }
    return { ok: false, status: response.status, error: `Discord returned ${response.status}` };
  } catch (error) {
    return { ok: false, status: 0, error: error instanceof Error ? error.message : "Network error" };
  }
}

/** Post via webhook when available, otherwise via bot token + channel snowflake. */
export async function postTeamDiscordMessage(input: {
  content: string;
  webhookUrl?: string | null;
  channelId?: string | null;
}): Promise<DiscordPostResult> {
  const content = input.content.trim();
  if (!content) return { ok: false, status: 0, error: "Message is empty" };

  if (input.webhookUrl && isValidDiscordWebhook(input.webhookUrl)) {
    return postToDiscord(input.webhookUrl, content);
  }
  if (input.channelId?.trim()) {
    return postViaDiscordBot(input.channelId.trim(), content);
  }
  return { ok: false, status: 0, error: "No Discord webhook or channel configured" };
}
