import type { Lesson } from "../../lib/cad-learn/track";

export type ProgressRow = { lessonId: string; viewedAt: string; completedAt: string | null };
export type ReferenceRow = {
  lessonId: string;
  documentId: string;
  workspaceId: string;
  elementId: string;
  massKg: number;
  volumeM3: number | null;
  principalInertia: number[] | null;
  material: string;
  measuredAt: string;
  measuredByName: string | null;
};
export type SubmissionRow = {
  id: string;
  lessonId: string;
  userId: string;
  displayName: string | null;
  massKg: number;
  massPercentDifference: number;
  inertiaPercentDifference: number | null;
  overallBand: "match" | "close" | "off";
  material: string;
  gradedAt: string;
};
export type TeamRow = {
  userId: string;
  displayName: string;
  viewed: number;
  completed: number;
  lastActivityAt: string | null;
  gradedBest: string | null;
};

export type CadLearnView = {
  orgId: string;
  orgName: string;
  canManage: boolean;
  progress: ProgressRow[];
  references: ReferenceRow[];
  submissions: SubmissionRow[];
  team: TeamRow[] | null;
};

export type GradeFactor = {
  id: "mass" | "moment_of_inertia";
  label: string;
  unit: string;
  reference: number;
  student: number;
  percentDifference: number;
  band: "match" | "close" | "off";
};

export type GradeResponse =
  | {
      status: "graded";
      lessonTitle: string;
      material: string;
      referenceMeasuredAt: string;
      openUrl: string;
      grade: {
        overall: "match" | "close" | "off";
        material: string;
        factors: GradeFactor[];
        perAxisInertiaPercent: number[] | null;
        inertiaUngradedReason: string | null;
        densityCheck: {
          referenceKgM3: number;
          studentKgM3: number;
          percentDifference: number;
          sameMaterial: boolean;
        } | null;
        whatToCheck: string[];
      };
    }
  | { status: "no_reference"; message: string }
  | { status: "not_connected"; message: string }
  | { status: "cannot_read"; reason: string; message: string }
  | { status: "error"; message: string };

export const BAND_LABEL: Record<"match" | "close" | "off", string> = {
  match: "Match",
  close: "Close",
  off: "Off",
};

export function formatPercent(value: number): string {
  const rounded = Math.abs(value) < 0.05 ? 0 : value;
  return `${rounded > 0 ? "+" : ""}${rounded.toFixed(1)}%`;
}

export function formatKg(value: number): string {
  if (value >= 1) return `${value.toFixed(3)} kg`;
  return `${(value * 1000).toFixed(1)} g`;
}

export function isCadLearnView(value: unknown): value is CadLearnView {
  if (!value || typeof value !== "object") return false;
  const row = value as { orgId?: unknown; progress?: unknown };
  return typeof row.orgId === "string" && Array.isArray(row.progress);
}

export type { Lesson };
