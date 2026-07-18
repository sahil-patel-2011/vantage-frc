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
  return trimmed.length > 2000 ? `${trimmed.slice(0, 1997)}…` : trimmed;
}

export type DiscordPostResult = { ok: boolean; status: number; error?: string };

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
