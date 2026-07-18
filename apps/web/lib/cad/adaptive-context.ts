import type { PoolClient } from "@neondatabase/serverless";
import {
  DEFAULT_CAD_TEAM_PROFILE,
  DEFAULT_CAD_USER_PREFERENCES,
  type CadTeamProfile,
  type CadUserPreferences,
} from "@vantage/cad";

export type CadAdaptiveContext = {
  teamProfile: CadTeamProfile;
  userPreferences: CadUserPreferences;
  canManageTeamProfile: boolean;
  profileConfigured: boolean;
};

function list(value: unknown, max = 16) {
  const values = Array.isArray(value) ? value : String(value ?? "").split(/\r?\n|,/);
  return [...new Set(values.map((entry) => String(entry).trim()).filter(Boolean))]
    .slice(0, max)
    .map((entry) => entry.slice(0, 180));
}

export function parseCadTeamProfile(value: Record<string, unknown>): CadTeamProfile {
  const defaultPlatform = ["onshape", "fusion360", "mock"].includes(String(value.defaultPlatform))
    ? (String(value.defaultPlatform) as CadTeamProfile["defaultPlatform"])
    : "onshape";
  return {
    defaultPlatform,
    preferredUnits: value.preferredUnits === "in" ? "in" : "mm",
    manufacturingProcesses: list(value.manufacturingProcesses),
    preferredMaterials: list(value.preferredMaterials),
    standardComponents: list(value.standardComponents),
    designRules: list(value.designRules),
  };
}

export function parseCadUserPreferences(value: Record<string, unknown>): CadUserPreferences {
  const responseStyle = ["concise", "teaching", "expert"].includes(String(value.responseStyle))
    ? (String(value.responseStyle) as CadUserPreferences["responseStyle"])
    : "teaching";
  const explanationDepth = ["minimal", "standard", "deep"].includes(String(value.explanationDepth))
    ? (String(value.explanationDepth) as CadUserPreferences["explanationDepth"])
    : "standard";
  const preferredUnits = ["team", "mm", "in"].includes(String(value.preferredUnits))
    ? (String(value.preferredUnits) as CadUserPreferences["preferredUnits"])
    : "team";
  const preferredPlatform = ["onshape", "fusion360", "mock"].includes(String(value.preferredPlatform))
    ? (String(value.preferredPlatform) as NonNullable<CadUserPreferences["preferredPlatform"]>)
    : null;
  return {
    responseStyle,
    explanationDepth,
    preferredUnits,
    preferredPlatform,
    customInstructions: String(value.customInstructions ?? "").trim().slice(0, 2_000),
  };
}

export async function loadCadAdaptiveContext(
  client: PoolClient,
  orgId: string,
  userId: string,
): Promise<CadAdaptiveContext> {
  try {
    const [team, user, membership] = await Promise.all([
      client.query<CadTeamProfile>(
        `SELECT default_platform AS "defaultPlatform",preferred_units AS "preferredUnits",
                manufacturing_processes AS "manufacturingProcesses",preferred_materials AS "preferredMaterials",
                standard_components AS "standardComponents",design_rules AS "designRules"
         FROM cad_team_profiles WHERE org_id=$1`,
        [orgId],
      ),
      client.query<CadUserPreferences>(
        `SELECT response_style AS "responseStyle",explanation_depth AS "explanationDepth",
                preferred_units AS "preferredUnits",preferred_platform AS "preferredPlatform",
                custom_instructions AS "customInstructions"
         FROM cad_user_preferences WHERE org_id=$1 AND user_id=$2`,
        [orgId, userId],
      ),
      client.query<{ role: string }>(
        `SELECT role::text AS role FROM memberships WHERE org_id=$1 AND user_id=$2`,
        [orgId, userId],
      ),
    ]);
    return {
      teamProfile: team.rows[0] ?? DEFAULT_CAD_TEAM_PROFILE,
      userPreferences: user.rows[0] ?? DEFAULT_CAD_USER_PREFERENCES,
      canManageTeamProfile: ["owner", "admin"].includes(membership.rows[0]?.role ?? ""),
      profileConfigured: Boolean(team.rows[0]),
    };
  } catch {
    return {
      teamProfile: DEFAULT_CAD_TEAM_PROFILE,
      userPreferences: DEFAULT_CAD_USER_PREFERENCES,
      canManageTeamProfile: false,
      profileConfigured: false,
    };
  }
}
