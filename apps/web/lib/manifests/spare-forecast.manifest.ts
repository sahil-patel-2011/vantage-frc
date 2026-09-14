export const manifest = {
  slug: "spare-forecast",
  title: "Spares forecast",
  route: "/spare-forecast",
  apiRoute: "/api/spare-forecast",
  hub: "Build",
  navGroup: "Build",
  metered: true,
  tables: ["spare_forecast_purchase_requests"],
  aiTools: [
    {
      name: "spare_forecast.purchase_requests",
      description:
        "Read this org's spare-parts exhaustion forecast and drafted purchase requests for the active season — logged repeat-failure rate x inventory spares on hand x season consumption cadence, with recommended reorder quantities and urgency.",
    },
  ],
  exportAdapters: [],
  placeholderRoute: false,
} as const;
