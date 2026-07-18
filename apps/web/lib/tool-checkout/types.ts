// Tool/equipment checkout domain types. Pure data shapes — no I/O, no framework imports.
// Tracks the shop tool registry and the loan record that answers "who has this and when
// is it due back" — bus-factor protection for physical tools.

export type ToolCategory =
  | "power_tool"
  | "hand_tool"
  | "measurement"
  | "electronics"
  | "computer"
  | "safety"
  | "other";

export type ToolCheckoutStatus = "available" | "checked_out" | "overdue";

export type ToolCheckoutLoan = {
  id: string;
  borrowerName: string;
  checkedOutAt: string;
  dueAt: string | null;
  returnedAt: string | null;
  notes: string | null;
};

export type ToolCheckoutTool = {
  id: string;
  name: string;
  category: ToolCategory;
  assetTag: string | null;
  location: string | null;
  notes: string | null;
  active: boolean;
  status: ToolCheckoutStatus;
  currentLoan: ToolCheckoutLoan | null;
  loanHistory: ToolCheckoutLoan[];
};

export type ToolCheckoutSummary = {
  totalTools: number;
  availableCount: number;
  checkedOutCount: number;
  overdueCount: number;
  byCategory: Array<{ category: ToolCategory; total: number; checkedOut: number }>;
};
