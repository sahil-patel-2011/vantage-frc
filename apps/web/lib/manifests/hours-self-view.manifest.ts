export const manifest = {
  slug: "hours-self-view",
  title: "My Hours (Self-View & Kiosk)",
  route: "/hours-self-view",
  apiRoute: "/api/hours-self-view",
  hub: "Team",
  navGroup: "Team",
  metered: false,
  tables: ["hours_self_view_kiosk_sessions", "hours_self_view_biometric_consents"],
  aiTools: [],
  exportAdapters: [],
  placeholderRoute: false,
} as const;
