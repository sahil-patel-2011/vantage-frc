// Pure aggregation/labeling helpers for tool checkout. Deterministic given input and an
// explicit "now" — no I/O, no framework imports, unit-testable in isolation.

import type { ToolCategory, ToolCheckoutLoan, ToolCheckoutStatus, ToolCheckoutSummary, ToolCheckoutTool } from "./types";

export const TOOL_CATEGORIES: ToolCategory[] = [
  "power_tool",
  "hand_tool",
  "measurement",
  "electronics",
  "computer",
  "safety",
  "other",
];

export function toolCategoryLabel(category: ToolCategory): string {
  const labels: Record<ToolCategory, string> = {
    power_tool: "Power tool",
    hand_tool: "Hand tool",
    measurement: "Measurement",
    electronics: "Electronics",
    computer: "Computer / device",
    safety: "Safety gear",
    other: "Other",
  };
  return labels[category];
}

/**
 * Status for a tool given its currently-open loan (if any) and "now". A tool with no
 * open loan is available; an open loan past its due date reads as overdue.
 */
export function statusFor(currentLoan: ToolCheckoutLoan | null, now: Date = new Date()): ToolCheckoutStatus {
  if (!currentLoan) return "available";
  if (currentLoan.dueAt && new Date(currentLoan.dueAt).getTime() < now.getTime()) return "overdue";
  return "checked_out";
}

/**
 * Roll a set of tools (each already annotated with its current status) into summary
 * counts by status and category. Skips nothing fabricated — purely a count over input.
 */
export function summarizeToolCheckout(tools: ToolCheckoutTool[]): ToolCheckoutSummary {
  const categoryMap = new Map<ToolCategory, { total: number; checkedOut: number }>();
  let availableCount = 0;
  let checkedOutCount = 0;
  let overdueCount = 0;

  for (const tool of tools) {
    const bucket = categoryMap.get(tool.category) ?? { total: 0, checkedOut: 0 };
    bucket.total += 1;
    if (tool.status !== "available") bucket.checkedOut += 1;
    categoryMap.set(tool.category, bucket);

    if (tool.status === "available") availableCount += 1;
    else if (tool.status === "overdue") overdueCount += 1;
    else checkedOutCount += 1;
  }

  const byCategory = [...categoryMap.entries()]
    .map(([category, value]) => ({ category, total: value.total, checkedOut: value.checkedOut }))
    .sort((a, b) => b.total - a.total);

  return {
    totalTools: tools.length,
    availableCount,
    checkedOutCount,
    overdueCount,
    byCategory,
  };
}
