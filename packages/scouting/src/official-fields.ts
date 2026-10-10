import { classifyComparableField, isOutcomeObservationOnlyKey } from "@vantage/reference/match-cross-validation";
import type { FieldDefinition } from "./index";

export const OFFICIAL_COMPARISON_MODES = ["auto", "none", "climb", "mobility", "foul"] as const;
export type OfficialComparisonMode = typeof OFFICIAL_COMPARISON_MODES[number];
export type RobotComparisonKind = "climb" | "mobility" | "foul";
export type OfficialFieldComparison = {
  kind: RobotComparisonKind | null;
  source: "configured" | "strategy" | "convention" | "none";
  message: string;
};

export function isOfficialComparisonMode(value: unknown): value is OfficialComparisonMode {
  return typeof value === "string" && (OFFICIAL_COMPARISON_MODES as readonly string[]).includes(value);
}

export function supportsOfficialComparison(type: FieldDefinition["type"], kind: RobotComparisonKind): boolean {
  const choice = ["boolean", "select", "dropdown", "multiple_choice"].includes(type);
  return kind === "foul" ? type === "number" || type === "counter" : choice;
}

/** Read the report's original question, never a newer form or a question label. */
export function officialComparisonForField(field: FieldDefinition): OfficialFieldComparison {
  const setting = field.config?.officialComparison;
  if (setting !== undefined && !isOfficialComparisonMode(setting)) return { kind: null, source: "none", message: "Choose a supported official comparison in Forms." };
  if (setting === "none") return { kind: null, source: "configured", message: "Official checking is off for this question." };
  let kind: RobotComparisonKind | null = null;
  let source: OfficialFieldComparison["source"] = "convention";
  if (setting === "climb" || setting === "mobility" || setting === "foul") { kind = setting; source = "configured"; }
  else if (isOutcomeObservationOnlyKey(field.key) || field.config?.role === "none") {
    return { kind: null, source: "none", message: "Attempts, capabilities and points stay scout observations." };
  }
  else if (field.config?.role === "endgame") { kind = "climb"; source = "strategy"; }
  else if (field.config?.role === "fouls") { kind = "foul"; source = "strategy"; }
  else if (["auto_score", "teleop_score", "defense", "notes"].includes(String(field.config?.role))) {
    return { kind: null, source: "none", message: "This strategy signal has no robot-level official comparison." };
  } else {
    const inferred = classifyComparableField(field.key);
    kind = inferred === "other" ? null : inferred;
  }
  if (!kind) return { kind: null, source: "none", message: "Scout observation; no official comparison selected." };
  if (!supportsOfficialComparison(field.type, kind)) return { kind: null, source, message: kind === "foul"
    ? "Robot foul counts need a number or counter question."
    : "Robot outcome checks need a Yes / No or single-choice question; points and counts stay observations." };
  return { kind, source, message: kind === "climb" ? "Use Yes / No for climb success, or posted outcome labels for levels. Attempts stay separate."
    : kind === "mobility" ? "Checks the robot's posted autonomous mobility outcome."
    : "Checks robot-attributed fouls only when posted; alliance totals stay separate." };
}

/** Explicit unsupported metadata must fail publication rather than silently do nothing. */
export function officialComparisonConfigError(field: FieldDefinition): string | null {
  const mode = field.config?.officialComparison;
  if (mode === undefined || mode === "auto" || mode === "none") return null;
  if (mode !== "climb" && mode !== "mobility" && mode !== "foul") return "Choose a supported official comparison.";
  return supportsOfficialComparison(field.type, mode) ? null : officialComparisonForField(field).message;
}
