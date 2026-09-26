/**
 * The words on a scouting conflict card. The list arrives with raw keys
 * ("2026gacmp_qm7", "frc3310", "autoPoints") and a placeholder name for an entry
 * whose scout has no account; a lead should read "Qual 7 · 3310", "Auto points"
 * and "Team scout".
 */
import type { FieldDefinition } from "@vantage/scouting";
import { matchLabelFromKey } from "../matches/no-next-match";

export function conflictTitle(matchKey: unknown, teamKey: unknown): string {
  const match = typeof matchKey === "string" && matchKey ? matchLabelFromKey(matchKey) : "Match";
  const team = typeof teamKey === "string" ? teamKey.replace(/^frc/i, "") : "";
  return team ? `${match} · ${team}` : match;
}

/** "autoPoints" / "auto_points" → "Auto points" when the form has no label for it. */
export function humanizeFieldKey(key: string): string {
  const spaced = key
    .replace(/[_-]+/g, " ")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .trim()
    .toLowerCase();
  return spaced ? spaced.charAt(0).toUpperCase() + spaced.slice(1) : key;
}

export function conflictFieldLabel(
  fieldKey: unknown,
  fields: ReadonlyArray<Pick<FieldDefinition, "key" | "label">> | null | undefined,
): string {
  const key = typeof fieldKey === "string" ? fieldKey : "";
  if (!key) return "A field";
  const label = fields?.find((field) => field.key === key)?.label?.trim();
  return label || humanizeFieldKey(key);
}

/** A candidate whose scout could not be named reads as "Team scout", never "Unknown scout". */
export function conflictScoutName(name: unknown): string {
  const text = typeof name === "string" ? name.trim() : "";
  if (!text || /^unknown scout$/i.test(text)) return "Team scout";
  return text;
}

/** How a recorded value reads: 4, "Climb", "Yes". */
export function conflictValueLabel(value: unknown): string {
  if (value == null || value === "") return "Left blank";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "number") return String(value);
  if (typeof value === "string") {
    const lower = value.toLowerCase();
    if (lower === "true" || lower === "yes") return "Yes";
    if (lower === "false" || lower === "no") return "No";
    return value.charAt(0).toUpperCase() + value.slice(1).replaceAll("_", " ");
  }
  return JSON.stringify(value);
}

/** Why a closed disagreement is closed, when no scout was picked as right. */
export function conflictClosedReason(resolution: unknown, status: string): string {
  const reason =
    resolution && typeof resolution === "object" ? (resolution as { reason?: unknown }).reason : undefined;
  if (reason === "values_now_agree") return "The reports now agree";
  if (reason === "report_deleted") return "One of the reports was deleted";
  return status === "dismissed" ? "Dismissed" : "Resolved";
}
