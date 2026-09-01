// Grant Report domain types. Pure data shapes — no I/O, no framework imports.
// A post-grant impact report is generated for an awarded grant application, grounded only in
// this org's own recorded outreach (outreach_messages) and finance (finance_transactions /
// purchase_requests) data — never fabricated metrics.

export type GrantReportEligibleGrant = {
  id: string;
  name: string;
  funder: string | null;
  seasonYear: number;
  amountAwardedUsd: number;
  decisionAt: string | null;
  hasReport: boolean;
};

export type GrantReportOutreachLine = {
  kind: string;
  count: number;
};

export type GrantReportSpendLine = {
  category: string;
  totalUsd: number;
  count: number;
};

export type GrantReportSection = {
  id: string;
  title: string;
  body: string;
};

export type GrantReport = {
  id: string;
  grantApplicationId: string;
  grantName: string;
  funder: string | null;
  seasonYear: number;
  amountAwardedUsd: number;
  /** Only explicitly allocated spend. Zero when allocation schema is unavailable. */
  totalSpendUsd: number;
  spendAttribution: "explicit" | "setup_required";
  outreachCount: number;
  outreachByKind: GrantReportOutreachLine[];
  spendByCategory: GrantReportSpendLine[];
  sections: GrantReportSection[];
  narrative: string;
  createdAt: string;
};
