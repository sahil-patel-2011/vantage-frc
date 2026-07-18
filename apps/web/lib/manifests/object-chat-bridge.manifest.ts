export const manifest = {
  slug: "object-chat-bridge",
  title: "Object Chat Bridge",
  route: "/object-chat-bridge",
  apiRoute: "/api/object-chat-bridge",
  hub: "Team",
  navGroup: "Team",
  metered: false,
  tables: ["object_chat_bridge_links", "object_chat_bridge_notifications"],
  aiTools: [],
  exportAdapters: [],
  placeholderRoute: false,
} as const;
