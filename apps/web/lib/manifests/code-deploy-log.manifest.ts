export const manifest = {
  slug: "code-deploy-log",
  title: "Code Deploy Log",
  route: "/code-deploy-log",
  apiRoute: "/api/code-deploy-log",
  hub: "Build",
  navGroup: "Build",
  metered: false,
  tables: ["code_deploy_log_entries"],
  aiTools: [],
  exportAdapters: [],
  placeholderRoute: false,
} as const;
