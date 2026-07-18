// Pure helper functions for exit-interview records — labels and summary rollups.
// No I/O, no framework imports; unit-testable in isolation.

import type { ExitInterviewRecord, ExitInterviewRole, ExitInterviewSummary } from "./types";

const ROLE_LABEL: Record<ExitInterviewRole, string> = {
  mechanical: "Mechanical",
  electrical: "Electrical",
  programming: "Programming",
  strategy: "Strategy / Scouting",
  outreach: "Outreach",
  leadership: "Leadership",
  mentor: "Mentor",
  other: "Other",
};

export function exitInterviewRoleLabel(role: ExitInterviewRole): string {
  return ROLE_LABEL[role] ?? role;
}

const STATUS_LABEL: Record<ExitInterviewRecord["status"], string> = {
  draft: "Draft",
  submitted: "Submitted",
};

export function exitInterviewStatusLabel(status: ExitInterviewRecord["status"]): string {
  return STATUS_LABEL[status] ?? status;
}

export function summarizeExitInterviews(records: ExitInterviewRecord[]): ExitInterviewSummary {
  const totalRecords = records.length;
  const submittedCount = records.filter((r) => r.status === "submitted").length;
  const draftCount = records.filter((r) => r.status === "draft").length;
  const mentorshipWillingCount = records.filter((r) => r.willingToMentor).length;

  const roleCounts = new Map<ExitInterviewRole, number>();
  for (const record of records) {
    roleCounts.set(record.role, (roleCounts.get(record.role) ?? 0) + 1);
  }
  const byRole = Array.from(roleCounts.entries())
    .map(([role, count]) => ({ role, count }))
    .sort((a, b) => b.count - a.count || a.role.localeCompare(b.role));

  const gradYearCounts = new Map<number, number>();
  for (const record of records) {
    gradYearCounts.set(record.graduationYear, (gradYearCounts.get(record.graduationYear) ?? 0) + 1);
  }
  const byGradYear = Array.from(gradYearCounts.entries())
    .map(([graduationYear, count]) => ({ graduationYear, count }))
    .sort((a, b) => a.graduationYear - b.graduationYear);

  return {
    totalRecords,
    submittedCount,
    draftCount,
    mentorshipWillingCount,
    byRole,
    byGradYear,
  };
}
