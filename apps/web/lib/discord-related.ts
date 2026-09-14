import { hubHref } from "./nav/hubs";
import { withOrgHref } from "./nav/product-nav";

/** Soft-UI related surfaces for Discord guild/bridge settings (never DEMO sync %). */
export const DISCORD_RELATED_LINKS = [
  { id: "messages", label: "Team chat", kind: "team" as const, tab: "messages" },
  { id: "team", label: "Team hub", kind: "path" as const, path: "/team" },
  { id: "alumni", label: "Alumni", kind: "path" as const, path: "/team/alumni" },
  { id: "notifications", label: "Notifications", kind: "path" as const, path: "/notifications" },
] as const;

export type DiscordRelatedId = (typeof DISCORD_RELATED_LINKS)[number]["id"];

export type DiscordRelatedLink = {
  id: DiscordRelatedId;
  label: string;
  href: string;
};

/** Focused Soft-UI strip — Messages + Team first for the object-linked bridge. */
export const DISCORD_RELATED_INCLUDE: DiscordRelatedId[] = ["messages", "team", "alumni"];

/** Cross-links for Discord Soft-UI (never DEMO bridge metrics). */
export function discordRelatedLinks(
  orgId?: string | null,
  options?: { active?: DiscordRelatedId; include?: DiscordRelatedId[] },
): DiscordRelatedLink[] {
  const include = options?.include ? new Set(options.include) : null;
  return DISCORD_RELATED_LINKS.filter((link) => {
    if (link.id === options?.active) return false;
    if (include && !include.has(link.id)) return false;
    return true;
  }).map((link) => {
    if (link.kind === "team") {
      return { id: link.id, label: link.label, href: hubHref("/team", link.tab, orgId) };
    }
    return { id: link.id, label: link.label, href: withOrgHref(link.path, orgId) };
  });
}

export type DiscordNextAction = {
  id: string;
  label: string;
  detail: string;
  href: string;
  primary?: boolean;
};

export type DiscordBridgeReadiness = {
  configured: boolean;
  hasWebhook: boolean;
  channelId: string | null;
  platformConfigured: boolean;
  chatBridgeEnabled: boolean;
};

/** True when announcements / bridge can post via webhook or bot+channel. */
export function canPostViaDiscord(input: {
  hasWebhook: boolean;
  channelId?: string | null;
  platformConfigured: boolean;
}): boolean {
  if (input.hasWebhook) return true;
  return Boolean(input.platformConfigured && input.channelId?.trim());
}

/**
 * Soft-UI next actions for Discord connection / object-linked bridge.
 * Points at real Messages + Team surfaces — never invents DEMO sync stats.
 */
export function discordNextActions(input: {
  orgId?: string | null;
  configured?: boolean;
  hasWebhook?: boolean;
  channelId?: string | null;
  platformConfigured?: boolean;
  chatBridgeEnabled?: boolean;
  bridgePostedCount?: number | null;
}): DiscordNextAction[] {
  const orgId = input.orgId ?? null;
  if (!orgId) {
    return [
      {
        id: "workspace",
        label: "Choose your team",
        detail: "Discord guild links and the object-linked chat bridge are saved per team.",
        href: "/workspace",
        primary: true,
      },
    ];
  }

  const discordHref = withOrgHref("/team/discord", orgId);
  const messagesHref = hubHref("/team", "messages", orgId);
  const teamHref = withOrgHref("/team", orgId);
  const actions: DiscordNextAction[] = [];

  const configured = Boolean(input.configured);
  const canPost = canPostViaDiscord({
    hasWebhook: Boolean(input.hasWebhook),
    channelId: input.channelId ?? null,
    platformConfigured: Boolean(input.platformConfigured),
  });

  if (!configured) {
    actions.push({
      id: "connect",
      label: "Link a Discord channel",
      detail: "Paste a Discord channel link and/or the server and channel IDs. Nothing posts until a path is saved.",
      href: discordHref,
      primary: true,
    });
  } else if (!canPost) {
    actions.push({
      id: "posting-path",
      label: "Add a Discord channel link",
      detail:
        "Posting needs a valid Discord channel link, or a mentor to add the Discord bot plus a channel id — Needs setup until one works.",
      href: discordHref,
      primary: true,
    });
  } else if (!input.chatBridgeEnabled) {
    actions.push({
      id: "enable-bridge",
      label: "Enable object-linked bridge",
      detail: "Only Team Messages with an object link (task, CAD, inventory, …) mirror — not a full chat dump.",
      href: discordHref,
      primary: true,
    });
  } else {
    actions.push({
      id: "send-linked",
      label: "Send an object-linked message",
      detail:
        input.bridgePostedCount && input.bridgePostedCount > 0
          ? `${input.bridgePostedCount} real bridge post${input.bridgePostedCount === 1 ? "" : "s"} recorded — open Messages to attach another object.`
          : "Bridge is on; counts stay blank until a linked Team Message actually posts to Discord.",
      href: messagesHref,
      primary: true,
    });
  }

  actions.push(
    {
      id: "messages",
      label: "Open Messages",
      detail: "Attach a task, CAD checkpoint, or inventory item so the Discord bridge has something real to mirror.",
      href: messagesHref,
      primary: actions.length === 0,
    },
    {
      id: "team",
      label: "Open Team hub",
      detail: "Calendar, attendance, and alumni sit next to Discord announcements for the same org.",
      href: teamHref,
    },
  );

  return actions.slice(0, 5);
}

/** Bridge post counts — blank until real discord_bridge_posts rows exist (never DEMO %). */
export function formatBridgePostCount(count: number | null | undefined): string {
  if (count == null || count < 0) return "—";
  return String(count);
}
