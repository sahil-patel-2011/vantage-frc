import { hubHref } from "./nav/hubs";
import { withOrgHref } from "./nav/product-nav";

export const SLACK_RELATED_INCLUDE = ["messages", "discord", "account"] as const;

export function slackRelatedLinks(orgId: string) {
  return [
    { id: "messages", label: "Team chat", href: hubHref("/team", "messages", orgId) },
    { id: "discord", label: "Discord", href: withOrgHref("/team/discord", orgId) },
    { id: "account", label: "Account connections", href: "/account?tab=integrations" },
  ];
}

export function slackNextActions(input: {
  orgId: string;
  configured?: boolean;
  hasWebhook?: boolean;
  chatBridgeEnabled?: boolean;
  inboundReady?: boolean;
}): Array<{ id: string; label: string; detail: string; href: string; primary?: boolean }> {
  const orgId = input.orgId;
  if (!input.configured) {
    return [
      {
        id: "webhook",
        label: "Paste a Slack incoming webhook",
        detail: "Slack → Apps → Incoming Webhooks. Outbound posts stay in this team’s workspace only.",
        href: withOrgHref("/team/slack", orgId),
        primary: true,
      },
      {
        id: "chat",
        label: "Open team chat",
        detail: "Vantage team chat works without Slack. Connect Slack only if you want both sides synced.",
        href: hubHref("/team", "messages", orgId),
      },
    ];
  }
  const actions = [];
  if (!input.hasWebhook) {
    actions.push({
      id: "webhook",
      label: "Finish the webhook",
      detail: "A valid hooks.slack.com URL is required before Vantage can post into Slack.",
      href: withOrgHref("/team/slack", orgId),
      primary: true,
    });
  }
  if (input.hasWebhook && !input.chatBridgeEnabled) {
    actions.push({
      id: "bridge",
      label: "Enable the chat bridge",
      detail: "When on, Team channel messages post to Slack and Slack messages appear in Vantage.",
      href: withOrgHref("/team/slack", orgId),
      primary: true,
    });
  }
  if (input.chatBridgeEnabled && !input.inboundReady) {
    actions.push({
      id: "events",
      label: "Set Slack event signing",
      detail: "Add SLACK_SIGNING_SECRET or a team signing secret so Slack→Vantage ingest can verify requests.",
      href: withOrgHref("/team/slack", orgId),
    });
  }
  actions.push({
    id: "chat",
    label: "Open team chat",
    detail: "Unread badges and inbox notifications stay in Vantage even when Slack is connected.",
    href: hubHref("/team", "messages", orgId),
    primary: actions.length === 0,
  });
  return actions.slice(0, 4);
}

export function formatSlackBridgePostCount(counts: { posted: number; failed: number } | null): string | null {
  if (!counts) return null;
  return `${counts.posted} posted · ${counts.failed} failed`;
}
