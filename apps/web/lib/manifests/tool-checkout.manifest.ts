export const manifest = {
  slug: "tool-checkout",
  title: "Tool Checkout",
  route: "/tool-checkout",
  apiRoute: "/api/tool-checkout",
  hub: "Team",
  navGroup: "Team",
  metered: false,
  tables: ["tool_checkout_tools", "tool_checkout_loans"],
  aiTools: [],
  exportAdapters: [],
  placeholderRoute: false,
} as const;
