// Object-linked subteam comm bridge domain types. Pure data shapes — no I/O, no framework
// imports. A "link" ties a chat thread (referenced by free-text ref, not FK'd) to a domain
// object (subsystem, order, incident) and a subteam that should be notified with context.

export type ObjectChatBridgeObjectType = "subsystem" | "order" | "incident" | "other";

export type ObjectChatBridgeSubteam = "mechanical" | "electrical" | "software" | "business" | "drive" | "other";

export type ObjectChatBridgeLinkStatus = "active" | "resolved" | "archived";

export type ObjectChatBridgeLink = {
  id: string;
  objectType: ObjectChatBridgeObjectType;
  objectRef: string;
  objectLabel: string | null;
  threadRef: string;
  subteam: ObjectChatBridgeSubteam;
  status: ObjectChatBridgeLinkStatus;
  context: string | null;
  seasonYear: number;
  createdAt: string;
  notifications: ObjectChatBridgeNotification[];
};

export type ObjectChatBridgeNotification = {
  id: string;
  linkId: string;
  notifiedSubteam: ObjectChatBridgeSubteam;
  message: string;
  acknowledged: boolean;
  acknowledgedAt: string | null;
  createdAt: string;
};

export type ObjectChatBridgeSummary = {
  totalLinks: number;
  activeLinks: number;
  resolvedLinks: number;
  archivedLinks: number;
  totalNotifications: number;
  unacknowledgedNotifications: number;
  bySubteam: Array<{ subteam: ObjectChatBridgeSubteam; count: number }>;
  byObjectType: Array<{ objectType: ObjectChatBridgeObjectType; count: number }>;
};
