// Grant Report domain types. Pure data shapes — no I/O, no framework imports.
// A post-grant impact report is generated for an awarded grant application, grounded only in
// this org's own recorded outreach (outreach_messages) and the finance_transactions rows a
// team explicitly TAGGED to that grant (finance_transactions.grant_application_id, 0504) —
// never fabricated metrics, never untagged org-wide spend presented as the grant's.

export type GrantReportEligibleGrant = {
  id: string;
  name: string;
  funder: string | null;
  seasonYear: number;
  amountAwardedUsd: number;
  decisionAt: string | null;
  hasReport: boolean;
  /** Expenses currently tagged to this grant — 0 means the report will say so explicitly. */
  taggedExpenseCount: number;
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

/**
 * Whether any expense has been tagged to the grant. `no_tagged_expenses` is an explicit,
 * honest state — the report says "no expenses tagged to this grant yet" instead of showing
 * org-wide spend as if it were fund usage.
 */
export type GrantReportSpendState = "no_tagged_expenses" | "tagged";

export type GrantReport = {
  id: string;
  grantApplicationId: string;
  grantName: string;
  funder: string | null;
  seasonYear: number;
  amountAwardedUsd: number;
  /** Sum of expenses tagged to THIS grant only (finance_transactions.grant_application_id). */
  totalSpendUsd: number;
  taggedExpenseCount: number;
  spendState: GrantReportSpendState;
  outreachCount: number;
  outreachByKind: GrantReportOutreachLine[];
  spendByCategory: GrantReportSpendLine[];
  sections: GrantReportSection[];
  narrative: string;
  createdAt: string;
};
