export const manifest = {
  slug: "cad-vault",
  title: "CAD Vault",
  route: "/cad-vault",
  apiRoute: "/api/cad-vault",
  hub: "Build",
  navGroup: "Build",
  metered: false,
  tables: ["cad_documents", "cad_document_versions"],
  aiTools: [],
  exportAdapters: [],
  placeholderRoute: false,
} as const;
