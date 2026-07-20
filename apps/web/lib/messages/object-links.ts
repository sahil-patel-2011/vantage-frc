import {
  DISCORD_OBJECT_TYPES,
  type DiscordObjectLink,
  type DiscordObjectType,
  isDiscordObjectType,
} from "../discord";

export type MessageObjectLink = DiscordObjectLink;
export { DISCORD_OBJECT_TYPES, isDiscordObjectType };
export type { DiscordObjectType };

/** Object types surfaced in the messages composer link picker. */
export const COMPOSER_OBJECT_TYPES: DiscordObjectType[] = [
  "task",
  "cad_checkpoint",
  "inventory_item",
  "event",
  "announcement",
];

export const OBJECT_TYPE_OPTIONS: Array<{ value: DiscordObjectType; label: string }> = [
  { value: "task", label: "Task" },
  { value: "cad_checkpoint", label: "CAD checkpoint" },
  { value: "inventory_item", label: "Inventory item" },
  { value: "goal", label: "Goal" },
  { value: "risk", label: "Risk" },
  { value: "event", label: "Event" },
  { value: "knowledge", label: "Knowledge" },
  { value: "announcement", label: "Announcement" },
];

export function normalizeObjectType(raw: unknown): DiscordObjectType | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim().toLowerCase();
  return isDiscordObjectType(trimmed) ? trimmed : null;
}

function withOrgQuery(path: string, orgId: string, extra?: Record<string, string>): string {
  const params = new URLSearchParams({ orgId });
  if (extra) {
    for (const [key, value] of Object.entries(extra)) {
      if (value) params.set(key, value);
    }
  }
  const join = path.includes("?") ? "&" : "?";
  return `${path}${join}${params.toString()}`;
}

/** In-app deep link for a linked object (relative path). */
export function objectAppHref(orgId: string, objectType: DiscordObjectType, objectId: string): string {
  switch (objectType) {
    case "task":
      return withOrgQuery("/todos", orgId, { todoId: objectId });
    case "cad_checkpoint":
      return withOrgQuery("/cad", orgId, { checkpointId: objectId });
    case "inventory_item":
      return withOrgQuery("/inventory", orgId, { itemId: objectId });
    case "event":
      return withOrgQuery("/team/calendar", orgId, { eventId: objectId });
    case "announcement":
      return withOrgQuery("/notifications", orgId, { announcementId: objectId });
    case "goal":
      return withOrgQuery("/goals", orgId, { goalId: objectId });
    case "risk":
      return withOrgQuery("/risks", orgId, { riskId: objectId });
    case "knowledge":
      return withOrgQuery("/team", orgId, { tab: "knowledge", pageId: objectId });
    default:
      return withOrgQuery("/team", orgId, { tab: "messages" });
  }
}

/** Prefill the messages composer from calendar / announcements workflows. */
export function discussInMessagesHref(
  orgId: string,
  objectType: DiscordObjectType,
  objectId: string,
  label: string,
): string {
  const params = new URLSearchParams({
    orgId,
    tab: "messages",
    linkType: objectType,
    linkId: objectId,
    linkLabel: label,
  });
  return `/team?${params.toString()}`;
}

export function parseObjectLinkInput(raw: unknown): MessageObjectLink | null {
  if (!raw || typeof raw !== "object") return null;
  const value = raw as Record<string, unknown>;
  const objectType = typeof value.objectType === "string" ? value.objectType.trim() : "";
  const objectId = typeof value.objectId === "string" ? value.objectId.trim() : "";
  const label = typeof value.label === "string" ? value.label.trim() : "";
  const href = typeof value.href === "string" ? value.href.trim() : "";
  if (!isDiscordObjectType(objectType)) return null;
  if (!objectId || objectId.length > 128) return null;
  if (!label || label.length > 200) return null;
  if (href && href.length > 500) return null;
  if (href && !/^https?:\/\//i.test(href) && !href.startsWith("/")) return null;
  return { objectType, objectId, label, href: href || null };
}

export function parseComposerLinkFromSearch(params: URLSearchParams, orgId?: string | null): MessageObjectLink | null {
  const linkType = params.get("linkType");
  const linkId = params.get("linkId");
  const linkLabel = params.get("linkLabel");
  if (!linkType || !linkId || !linkLabel) return null;
  const objectType = normalizeObjectType(linkType);
  if (!objectType) return null;
  const resolvedOrgId = orgId ?? params.get("orgId");
  const href = resolvedOrgId ? objectAppHref(resolvedOrgId, objectType, linkId) : null;
  return parseObjectLinkInput({
    objectType,
    objectId: linkId,
    label: linkLabel,
    href,
  });
}
