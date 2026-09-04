"use client";

export type TeamOpsKey =
  | "start"
  | "practice"
  | "todos"
  | "messages"
  | "calendar"
  | "attendance"
  | "knowledge"
  | "logistics"
  | "goals"
  | "batteries"
  | "fmea"
  | "admin";

type TeamOpsNavProps = {
  orgId?: string | null;
  active?: TeamOpsKey;
  keys?: TeamOpsKey[];
  className?: string;
};

/** Retired: Team tools live in hub tabs and search, not a second pill row. */
export function TeamOpsNav(_props: TeamOpsNavProps) {
  return null;
}
