/**
 * Shared parse for onboarding / account role lists.
 *
 * `profiles.team_role` and `profiles.crew_role` stay plain text so existing
 * single-value rows keep working. Multiple picks are stored comma-separated.
 */

import type { OnboardingCrew, OnboardingRole } from "./step-model";

export const ONBOARDING_ROLES = ["student", "mentor", "coach", "parent", "other"] as const;
export const ONBOARDING_CREWS = [
  "scout",
  "driver",
  "operator",
  "mechanical",
  "electrical",
  "programming",
  "cad",
  "pit",
  "business",
  "other",
] as const;

const ROLE_SPLIT = /[\s,|/]+/;

export function splitRoleTokens(value: unknown): string[] {
  if (value == null || value === "") return [];
  const parts = Array.isArray(value) ? value : String(value).split(ROLE_SPLIT);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const part of parts) {
    const token = String(part ?? "").trim().toLowerCase();
    if (!token || seen.has(token)) continue;
    seen.add(token);
    out.push(token);
  }
  return out;
}

export function parseStoredRoles(value: unknown): OnboardingRole[] {
  return splitRoleTokens(value).filter((token): token is OnboardingRole =>
    (ONBOARDING_ROLES as readonly string[]).includes(token),
  );
}

export function parseStoredCrews(value: unknown): OnboardingCrew[] {
  return splitRoleTokens(value).filter((token): token is OnboardingCrew =>
    (ONBOARDING_CREWS as readonly string[]).includes(token),
  );
}

export function serializeStoredRoles(roles: readonly string[]): string | null {
  const cleaned = roles.map((role) => role.trim().toLowerCase()).filter(Boolean);
  return cleaned.length ? Array.from(new Set(cleaned)).join(",") : null;
}

export function primaryStoredRole(value: unknown): OnboardingRole | null {
  return parseStoredRoles(value)[0] ?? null;
}

export function primaryStoredCrew(value: unknown): OnboardingCrew | null {
  return parseStoredCrews(value)[0] ?? null;
}

export function formatRoleList(
  roles: readonly string[],
  labels: Record<string, string>,
): string {
  const names = roles.map((role) => labels[role] ?? role).filter(Boolean);
  if (names.length === 0) return "Not specified";
  if (names.length === 1) return names[0]!;
  return `${names.slice(0, -1).join(", ")} + ${names[names.length - 1]}`;
}
