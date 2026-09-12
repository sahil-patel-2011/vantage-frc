export const manifest = {
  slug: "pit-repair-triage",
  title: "Pit Repair Triage",
  route: "/pit-repair-triage",
  apiRoute: "/api/pit-repair-triage",
  hub: "Competition",
  navGroup: "Competition",
  metered: true,
  tables: ["pit_repair_triage_reports"],
  aiTools: [
    {
      name: "pit_repair_triage.reports",
      description:
        "Read this org's logged pit-repair failures for the active season, including the failure-history + spares-inventory + remaining-match-time triage decision (fix, swap, or monitor), confidence, and pre-stage recommendation.",
    },
  ],
  exportAdapters: [],
  placeholderRoute: false,
} as const;
