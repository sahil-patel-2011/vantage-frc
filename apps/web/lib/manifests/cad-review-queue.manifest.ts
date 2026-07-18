export const manifest = {
  slug: "cad-review-queue",
  title: "CAD Review Queue",
  route: "/cad-review-queue",
  apiRoute: "/api/cad-review-queue",
  hub: "Build",
  navGroup: "Build",
  metered: false,
  tables: ["cad_review_queue_items", "cad_review_queue_signoffs"],
  aiTools: [],
  exportAdapters: [],
  placeholderRoute: false,
} as const;
