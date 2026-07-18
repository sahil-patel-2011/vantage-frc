// Pure helper functions for the object-chat-bridge feature — unit-testable, no I/O.

import type {
  ObjectChatBridgeLink,
  ObjectChatBridgeLinkStatus,
  ObjectChatBridgeNotification,
  ObjectChatBridgeObjectType,
  ObjectChatBridgeSubteam,
  ObjectChatBridgeSummary,
} from "./types";

export const OBJECT_CHAT_BRIDGE_OBJECT_TYPES: ObjectChatBridgeObjectType[] = [
  "subsystem",
  "order",
  "incident",
  "other",
];

export const OBJECT_CHAT_BRIDGE_SUBTEAMS: ObjectChatBridgeSubteam[] = [
  "mechanical",
  "electrical",
  "software",
  "business",
  "drive",
  "other",
];

export const OBJECT_CHAT_BRIDGE_STATUSES: ObjectChatBridgeLinkStatus[] = ["active", "resolved", "archived"];

export function objectTypeLabel(type: ObjectChatBridgeObjectType): string {
  switch (type) {
    case "subsystem":
      return "Subsystem";
    case "order":
      return "Order";
    case "incident":
      return "Incident";
    default:
      return "Other";
  }
}

export function subteamLabel(subteam: ObjectChatBridgeSubteam): string {
  switch (subteam) {
    case "mechanical":
      return "Mechanical";
    case "electrical":
      return "Electrical";
    case "software":
      return "Software";
    case "business":
      return "Business";
    case "drive":
      return "Drive team";
    default:
      return "Other";
  }
}

export function statusLabel(status: ObjectChatBridgeLinkStatus): string {
  switch (status) {
    case "active":
      return "Active";
    case "resolved":
      return "Resolved";
    default:
      return "Archived";
  }
}

export function summarizeObjectChatBridge(links: ObjectChatBridgeLink[]): ObjectChatBridgeSummary {
  const bySubteamMap = new Map<ObjectChatBridgeSubteam, number>();
  const byObjectTypeMap = new Map<ObjectChatBridgeObjectType, number>();
  let activeLinks = 0;
  let resolvedLinks = 0;
  let archivedLinks = 0;
  let totalNotifications = 0;
  let unacknowledgedNotifications = 0;

  for (const link of links) {
    bySubteamMap.set(link.subteam, (bySubteamMap.get(link.subteam) ?? 0) + 1);
    byObjectTypeMap.set(link.objectType, (byObjectTypeMap.get(link.objectType) ?? 0) + 1);
    if (link.status === "active") activeLinks += 1;
    else if (link.status === "resolved") resolvedLinks += 1;
    else archivedLinks += 1;

    for (const notification of link.notifications) {
      totalNotifications += 1;
      if (!notification.acknowledged) unacknowledgedNotifications += 1;
    }
  }

  return {
    totalLinks: links.length,
    activeLinks,
    resolvedLinks,
    archivedLinks,
    totalNotifications,
    unacknowledgedNotifications,
    bySubteam: OBJECT_CHAT_BRIDGE_SUBTEAMS.filter((subteam) => bySubteamMap.has(subteam)).map((subteam) => ({
      subteam,
      count: bySubteamMap.get(subteam) ?? 0,
    })),
    byObjectType: OBJECT_CHAT_BRIDGE_OBJECT_TYPES.filter((objectType) => byObjectTypeMap.has(objectType)).map(
      (objectType) => ({
        objectType,
        count: byObjectTypeMap.get(objectType) ?? 0,
      }),
    ),
  };
}

export function sortNotificationsByRecency(
  notifications: ObjectChatBridgeNotification[],
): ObjectChatBridgeNotification[] {
  return [...notifications].sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0));
}
