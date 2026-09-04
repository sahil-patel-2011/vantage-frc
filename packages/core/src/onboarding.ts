import type { PoolClient } from "@neondatabase/serverless";
import { assertLegalAccepted, recordLegalAcceptance } from "./legal";

export const GENDER_OPTIONS = [
  "female",
  "male",
  "non_binary",
  "prefer_not_to_say",
  "other",
] as const;

export const TEAM_ROLE_OPTIONS = [
  "student",
  "mentor",
  "coach",
  "parent",
  "other",
] as const;

export const CREW_ROLE_OPTIONS = [
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

export const PRIMARY_FOCUS_OPTIONS = ["competition", "build", "business", "leadership"] as const;

export const TEAM_AFFILIATION_OPTIONS = [
  "private_school",
  "public_school",
  "community",
] as const;

export type GenderOption = (typeof GENDER_OPTIONS)[number];
export type TeamRoleOption = (typeof TEAM_ROLE_OPTIONS)[number];
export type CrewRoleOption = (typeof CREW_ROLE_OPTIONS)[number];
export type PrimaryFocusOption = (typeof PRIMARY_FOCUS_OPTIONS)[number];
export type TeamAffiliationOption = (typeof TEAM_AFFILIATION_OPTIONS)[number];
export type OnboardingStep = "profile" | "team" | "preferences" | "complete";

export type OrgLocationInput = {
  city?: string | null;
  stateProv?: string | null;
  description?: string | null;
  termsAccepted?: boolean;
  privacyAccepted?: boolean;
};

export type OrgFundingInput = {
  teamAffiliation?: TeamAffiliationOption | null;
  schoolFunded?: boolean | null;
  outsideGrants?: boolean | null;
  sponsorsAllowed?: boolean | null;
};

export type NormalizedOrgLocation = {
  city: string | null;
  stateProv: string | null;
  description: string | null;
};

export type OnboardingPayload = {
  firstName: string;
  lastName: string;
  dateOfBirth: string;
  gender: GenderOption;
  preferredTeamNumber: number | null;
  teamRole?: TeamRoleOption | TeamRoleOption[] | string | null;
  crewRole?: CrewRoleOption | CrewRoleOption[] | string | null;
  /** Extra identities — stored comma-separated in `profiles.team_role`. */
  teamRoles?: TeamRoleOption[];
  /** Extra crew jobs — stored comma-separated in `profiles.crew_role`. */
  crewRoles?: CrewRoleOption[];
  roleDescription?: string | null;
  primaryFocus: PrimaryFocusOption;
  displayName?: string | null;
  themePreference?: "light" | "dark";
  city?: string | null;
  stateProv?: string | null;
  description?: string | null;
  /** Terms of Service consent. Separate from privacyAccepted; both are required. */
  termsAccepted?: boolean;
  /** Privacy Policy consent. Separate from termsAccepted; both are required. */
  privacyAccepted?: boolean;
  teamAffiliation?: TeamAffiliationOption | null;
  schoolFunded?: boolean | null;
  outsideGrants?: boolean | null;
  sponsorsAllowed?: boolean | null;
};

export type OnboardingState = {
  complete: boolean;
  firstName: string | null;
  lastName: string | null;
  dateOfBirth: string | null;
  gender: string | null;
  preferredTeamNumber: number | null;
  teamRole: string | null;
  crewRole: string | null;
  roleDescription: string | null;
  primaryFocus: PrimaryFocusOption;
  displayName: string | null;
  themePreference: "light" | "dark";
  lockedTeamNumber: number | null;
  lockedOrgName: string | null;
  lockedOrgId: string | null;
  isTeamHead: boolean;
  orgCity: string | null;
  orgStateProv: string | null;
  orgDescription: string | null;
  orgTeamAffiliation: TeamAffiliationOption | null;
  orgSchoolFunded: boolean | null;
  orgOutsideGrants: boolean | null;
  orgSponsorsAllowed: boolean | null;
  canCreateOrg: boolean;
  platformAdmin: boolean;
  termsAcceptedAt: string | null;
  termsVersion: string | null;
  privacyAcceptedAt: string | null;
  privacyVersion: string | null;
  currentStep: OnboardingStep;
  startedAt: string | null;
  savedAt: string | null;
  accessStatus: "approved" | "invited" | "pending" | "declined" | "withdrawn" | "none";
  accessRequestId: string | null;
  workspaceOrgId: string | null;
  workspaceOrgName: string | null;
  requestCreatedAt: string | null;
};

export type OnboardingDraftInput =
  | Pick<OnboardingPayload, "firstName" | "lastName" | "dateOfBirth" | "gender"> & { step: "profile" }
  | Pick<OnboardingPayload, "preferredTeamNumber" | "teamRole" | "crewRole" | "teamRoles" | "crewRoles" | "roleDescription" | "primaryFocus"> & { step: "team" }
  | Pick<OnboardingPayload, "displayName" | "themePreference"> & { step: "preferences" };

function trimOrNull(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.slice(0, max);
}

/** Blank / null is allowed. A number never auto-joins — it only routes an approval request. */
export function parsePreferredTeamNumber(value: unknown): number | null {
  if (value == null || value === "") return null;
  const teamNumber = Number(value);
  if (!Number.isInteger(teamNumber) || teamNumber < 1 || teamNumber > 99999) {
    throw new Error("FRC team number must be between 1 and 99999, or left blank.");
  }
  return teamNumber;
}

const ROLE_SPLIT = /[\s,|/]+/;

function tokensFromRoleValue(value: unknown): string[] {
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

export function serializeRoleList(roles: readonly string[]): string | null {
  const cleaned = roles.map((role) => role.trim().toLowerCase()).filter(Boolean);
  return cleaned.length ? Array.from(new Set(cleaned)).join(",") : null;
}

export function parseTeamRoles(value: unknown): TeamRoleOption[] {
  const tokens = tokensFromRoleValue(value);
  if (tokens.length === 0) return [];
  const out: TeamRoleOption[] = [];
  for (const token of tokens) {
    if (!TEAM_ROLE_OPTIONS.includes(token as TeamRoleOption)) {
      throw new Error("Select a valid team role.");
    }
    out.push(token as TeamRoleOption);
  }
  return out.slice(0, 5);
}

export function parseCrewRoles(value: unknown): CrewRoleOption[] {
  const tokens = tokensFromRoleValue(value);
  if (tokens.length === 0) return [];
  const out: CrewRoleOption[] = [];
  for (const token of tokens) {
    if (!CREW_ROLE_OPTIONS.includes(token as CrewRoleOption)) {
      throw new Error("Select a valid crew role.");
    }
    out.push(token as CrewRoleOption);
  }
  return out.slice(0, 10);
}

/** First listed crew, or null. Accepts a single value or a comma-separated list. */
export function parseCrewRole(value: unknown): CrewRoleOption | null {
  return parseCrewRoles(value)[0] ?? null;
}

export function parseRoleDescription(value: unknown): string | null {
  const description = trimOrNull(value, 280);
  if (typeof value === "string" && value.trim().length > 280) {
    throw new Error("Role description must be 280 characters or fewer.");
  }
  return description;
}

export function isMissingWorkspaceError(error: unknown): boolean {
  return error instanceof Error && /No Vantage workspace exists/i.test(error.message);
}

export function normalizeOrgLocationFields(
  input: OrgLocationInput,
  options: { requireLocation: boolean },
): NormalizedOrgLocation {
  const city = trimOrNull(input.city, 120);
  const stateProv = trimOrNull(input.stateProv, 80);
  const description = trimOrNull(input.description, 2000);

  if (options.requireLocation) {
    if (!city) throw new Error("City is required.");
    if (!stateProv) throw new Error("State or province is required.");
  }

  return { city, stateProv, description };
}

export function parseDob(value: string): Date {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (!match) throw new Error("Enter your date of birth as YYYY-MM-DD.");
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const dob = new Date(Date.UTC(year, month - 1, day));
  if (
    dob.getUTCFullYear() !== year ||
    dob.getUTCMonth() !== month - 1 ||
    dob.getUTCDate() !== day
  ) {
    throw new Error("That date of birth is not valid.");
  }
  const today = new Date();
  const todayUtc = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  if (dob.getTime() > todayUtc) throw new Error("Date of birth cannot be in the future.");
  const oldest = Date.UTC(today.getUTCFullYear() - 120, today.getUTCMonth(), today.getUTCDate());
  if (dob.getTime() < oldest) throw new Error("Date of birth is out of range.");
  return dob;
}

export function validateOnboardingPayload(input: OnboardingPayload): OnboardingPayload {
  assertLegalAccepted({
    termsAccepted: input.termsAccepted,
    privacyAccepted: input.privacyAccepted,
  });
  const firstName = input.firstName.trim();
  const lastName = input.lastName.trim();
  if (firstName.length < 1 || firstName.length > 60) throw new Error("First name is required (max 60 characters).");
  if (lastName.length < 1 || lastName.length > 60) throw new Error("Last name is required (max 60 characters).");
  if (!GENDER_OPTIONS.includes(input.gender)) throw new Error("Select a gender option.");
  const teamNumber = parsePreferredTeamNumber(input.preferredTeamNumber);
  const teamRoles = parseTeamRoles(input.teamRoles?.length ? input.teamRoles : input.teamRole);
  const crewRoles = parseCrewRoles(input.crewRoles?.length ? input.crewRoles : input.crewRole);
  const roleDescription = parseRoleDescription(input.roleDescription);
  if (!PRIMARY_FOCUS_OPTIONS.includes(input.primaryFocus)) {
    throw new Error("Select a valid primary focus.");
  }
  const displayName = input.displayName?.trim() || `${firstName} ${lastName}`.trim();
  if (displayName.length > 80) throw new Error("Display name must be 80 characters or fewer.");
  const themePreference = input.themePreference === "dark" ? "dark" : "light";
  parseDob(input.dateOfBirth);
  const location = normalizeOrgLocationFields(input, { requireLocation: false });
  let teamAffiliation: TeamAffiliationOption | null = null;
  if (input.teamAffiliation != null) {
    if (!TEAM_AFFILIATION_OPTIONS.includes(input.teamAffiliation)) {
      throw new Error("Select private school, public school, or community team.");
    }
    teamAffiliation = input.teamAffiliation;
  }
  return {
    firstName,
    lastName,
    dateOfBirth: input.dateOfBirth.trim(),
    gender: input.gender,
    termsAccepted: true,
    privacyAccepted: true,
    preferredTeamNumber: teamNumber,
    teamRole: teamRoles[0] ?? null,
    crewRole: crewRoles[0] ?? null,
    teamRoles,
    crewRoles,
    roleDescription,
    primaryFocus: input.primaryFocus,
    displayName,
    themePreference,
    city: location.city,
    stateProv: location.stateProv,
    description: location.description,
    teamAffiliation,
    schoolFunded: input.schoolFunded ?? null,
    outsideGrants: input.outsideGrants ?? null,
    sponsorsAllowed: input.sponsorsAllowed ?? null,
  };
}

type LockedOrgRow = {
  orgId: string;
  teamNumber: number;
  orgName: string;
  role: string | null;
  city: string | null;
  stateProv: string | null;
  description: string | null;
  accessStatus: OnboardingState["accessStatus"];
  requestId: string | null;
  requestCreatedAt: string | null;
};

function isTeamHeadRole(role: string | null | undefined): boolean {
  return role === "owner" || role === "admin";
}

export async function getOnboardingState(client: PoolClient, userId: string): Promise<OnboardingState> {
  const profile = await client.query<{
    firstName: string | null;
    lastName: string | null;
    dateOfBirth: string | null;
    gender: string | null;
    preferredTeamNumber: number | null;
    teamRole: string | null;
    crewRole: string | null;
    roleDescription: string | null;
    primaryFocus: PrimaryFocusOption | null;
    displayName: string | null;
    themePreference: string | null;
    onboardingCompletedAt: string | null;
    termsAcceptedAt: string | null;
    termsVersion: string | null;
    privacyAcceptedAt: string | null;
    privacyVersion: string | null;
    currentStep: OnboardingStep | null;
    startedAt: string | null;
    savedAt: string | null;
  }>(
    `SELECT first_name AS "firstName",
            last_name AS "lastName",
            date_of_birth::text AS "dateOfBirth",
            gender,
            preferred_team_number AS "preferredTeamNumber",
            team_role AS "teamRole",
            crew_role AS "crewRole",
            role_description AS "roleDescription",
            primary_focus AS "primaryFocus",
            display_name AS "displayName",
            theme_preference AS "themePreference",
            onboarding_completed_at::text AS "onboardingCompletedAt",
            terms_accepted_at::text AS "termsAcceptedAt",
            terms_version AS "termsVersion",
            privacy_accepted_at::text AS "privacyAcceptedAt",
            privacy_version AS "privacyVersion",
            onboarding_current_step AS "currentStep",
            onboarding_started_at::text AS "startedAt",
            onboarding_saved_at::text AS "savedAt"
     FROM profiles WHERE user_id=$1`,
    [userId],
  );
  const admin = await client.query(`SELECT 1 FROM platform_admins WHERE user_id=$1`, [userId]);
  const workspace = await client.query<LockedOrgRow>(
    `SELECT org_id AS "orgId",team_number AS "teamNumber",org_name AS "orgName",
            member_role AS role,access_status AS "accessStatus",request_id AS "requestId",
            request_created_at::text AS "requestCreatedAt",city,state_prov AS "stateProv",description
       FROM onboarding_workspace_for_current_user()`,
  );
  const locked = workspace.rows[0] ?? null;
  const workspaceLocked = locked && ["approved", "invited", "pending"].includes(locked.accessStatus);
  const row = profile.rows[0];

  let orgFunding: {
    teamAffiliation: TeamAffiliationOption | null;
    schoolFunded: boolean | null;
    outsideGrants: boolean | null;
    sponsorsAllowed: boolean | null;
  } = {
    teamAffiliation: null,
    schoolFunded: null,
    outsideGrants: null,
    sponsorsAllowed: null,
  };
  if (locked?.orgId) {
    const funding = await client.query<{
      teamAffiliation: TeamAffiliationOption | null;
      schoolFunded: boolean | null;
      outsideGrants: boolean | null;
      sponsorsAllowed: boolean | null;
    }>(
      `SELECT team_affiliation AS "teamAffiliation",
              school_funded AS "schoolFunded",
              outside_grants AS "outsideGrants",
              sponsors_allowed AS "sponsorsAllowed"
       FROM organizations WHERE id = $1::uuid`,
      [locked.orgId],
    );
    if (funding.rows[0]) orgFunding = funding.rows[0];
  }

  return {
    complete: Boolean(row?.onboardingCompletedAt),
    firstName: row?.firstName ?? null,
    lastName: row?.lastName ?? null,
    dateOfBirth: row?.dateOfBirth ?? null,
    gender: row?.gender ?? null,
    preferredTeamNumber: row?.preferredTeamNumber ?? locked?.teamNumber ?? null,
    teamRole: row?.teamRole ?? null,
    crewRole: row?.crewRole ?? null,
    roleDescription: row?.roleDescription ?? null,
    primaryFocus: row?.primaryFocus ?? "competition",
    displayName: row?.displayName ?? null,
    themePreference: row?.themePreference === "dark" ? "dark" : "light",
    lockedTeamNumber: workspaceLocked ? locked.teamNumber : null,
    lockedOrgName: workspaceLocked ? locked.orgName : null,
    lockedOrgId: workspaceLocked ? locked.orgId : null,
    isTeamHead: workspaceLocked ? isTeamHeadRole(locked.role) : false,
    orgCity: locked?.city ?? null,
    orgStateProv: locked?.stateProv ?? null,
    orgDescription: locked?.description ?? null,
    orgTeamAffiliation: orgFunding.teamAffiliation,
    orgSchoolFunded: orgFunding.schoolFunded,
    orgOutsideGrants: orgFunding.outsideGrants,
    orgSponsorsAllowed: orgFunding.sponsorsAllowed,
    canCreateOrg: Boolean(admin.rowCount),
    platformAdmin: Boolean(admin.rowCount),
    termsAcceptedAt: row?.termsAcceptedAt ?? null,
    termsVersion: row?.termsVersion ?? null,
    privacyAcceptedAt: row?.privacyAcceptedAt ?? null,
    privacyVersion: row?.privacyVersion ?? null,
    currentStep: row?.onboardingCompletedAt ? "complete" : (row?.currentStep ?? "profile"),
    startedAt: row?.startedAt ?? null,
    savedAt: row?.savedAt ?? null,
    accessStatus: locked?.accessStatus ?? "none",
    accessRequestId: locked?.requestId ?? null,
    workspaceOrgId: locked?.orgId ?? null,
    workspaceOrgName: locked?.orgName ?? null,
    requestCreatedAt: locked?.requestCreatedAt ?? null,
  };
}

export async function saveOnboardingProgress(
  client: PoolClient,
  userId: string,
  input: OnboardingDraftInput,
): Promise<OnboardingState> {
  const state = await getOnboardingState(client, userId);
  if (state.complete && !["declined", "withdrawn", "none"].includes(state.accessStatus)) return state;

  if (input.step === "profile") {
    const firstName = input.firstName.trim();
    const lastName = input.lastName.trim();
    if (!firstName || firstName.length > 60) throw new Error("First name is required (max 60 characters).");
    if (!lastName || lastName.length > 60) throw new Error("Last name is required (max 60 characters).");
    if (!GENDER_OPTIONS.includes(input.gender)) throw new Error("Select a gender option.");
    parseDob(input.dateOfBirth);
    await client.query(
      `INSERT INTO profiles(user_id,first_name,last_name,date_of_birth,gender,onboarding_current_step,onboarding_started_at,onboarding_saved_at)
       VALUES($1,$2,$3,$4::date,$5,'team',now(),now())
       ON CONFLICT(user_id) DO UPDATE SET first_name=excluded.first_name,last_name=excluded.last_name,
         date_of_birth=excluded.date_of_birth,gender=excluded.gender,onboarding_current_step='team',
         onboarding_started_at=COALESCE(profiles.onboarding_started_at,now()),onboarding_saved_at=now()`,
      [userId, firstName, lastName, input.dateOfBirth.trim(), input.gender],
    );
  } else if (input.step === "team") {
    const teamNumber =
      state.lockedTeamNumber ?? parsePreferredTeamNumber(input.preferredTeamNumber);
    const teamRoles = parseTeamRoles(input.teamRoles?.length ? input.teamRoles : input.teamRole);
    if (!PRIMARY_FOCUS_OPTIONS.includes(input.primaryFocus)) throw new Error("Select a valid primary focus.");
    const crewRoles = parseCrewRoles(input.crewRoles?.length ? input.crewRoles : input.crewRole);
    const roleDescription = parseRoleDescription(input.roleDescription);
    await client.query(
      `INSERT INTO profiles(user_id,preferred_team_number,team_role,crew_role,role_description,primary_focus,onboarding_current_step,onboarding_started_at,onboarding_saved_at)
       VALUES($1,$2,$3,$4,$5,$6,'preferences',now(),now())
       ON CONFLICT(user_id) DO UPDATE SET preferred_team_number=excluded.preferred_team_number,
         team_role=excluded.team_role,crew_role=excluded.crew_role,role_description=excluded.role_description,
         primary_focus=excluded.primary_focus,onboarding_current_step='preferences',
         onboarding_started_at=COALESCE(profiles.onboarding_started_at,now()),onboarding_saved_at=now()`,
      [
        userId,
        teamNumber,
        serializeRoleList(teamRoles),
        serializeRoleList(crewRoles),
        roleDescription,
        input.primaryFocus,
      ],
    );
  } else {
    const displayName = trimOrNull(input.displayName, 80);
    const theme = input.themePreference === "dark" ? "dark" : "light";
    await client.query(
      `INSERT INTO profiles(user_id,display_name,theme_preference,onboarding_current_step,onboarding_started_at,onboarding_saved_at)
       VALUES($1,$2,$3,'preferences',now(),now())
       ON CONFLICT(user_id) DO UPDATE SET display_name=excluded.display_name,theme_preference=excluded.theme_preference,
         onboarding_current_step='preferences',onboarding_started_at=COALESCE(profiles.onboarding_started_at,now()),onboarding_saved_at=now()`,
      [userId, displayName, theme],
    );
  }
  return getOnboardingState(client, userId);
}

export async function isOnboardingComplete(client: PoolClient, userId: string): Promise<boolean> {
  const result = await client.query(
    `SELECT 1 FROM profiles WHERE user_id=$1 AND onboarding_completed_at IS NOT NULL`,
    [userId],
  );
  return Boolean(result.rowCount);
}

export async function completeOnboarding(
  client: PoolClient,
  userId: string,
  input: OnboardingPayload,
): Promise<OnboardingState> {
  const state = await getOnboardingState(client, userId);
  if (state.complete && !["declined", "withdrawn", "none"].includes(state.accessStatus)) return state;

  const payload = validateOnboardingPayload(input);
  const teamNumber =
    state.lockedTeamNumber != null ? state.lockedTeamNumber : payload.preferredTeamNumber;
  if (state.isTeamHead && teamNumber == null) {
    throw new Error("Team heads must keep their workspace team number.");
  }

  if (state.isTeamHead && state.lockedOrgId) {
    const location = normalizeOrgLocationFields(input, { requireLocation: true });
    if (!payload.teamAffiliation) {
      throw new Error("Select whether your team is a private school, public school, or community team.");
    }
    const schoolFunded = Boolean(payload.schoolFunded);
    const outsideGrants = Boolean(payload.outsideGrants);
    const sponsorsAllowed =
      payload.sponsorsAllowed == null ? true : Boolean(payload.sponsorsAllowed);
    if (!schoolFunded && !outsideGrants && !sponsorsAllowed) {
      throw new Error("Select at least one funding path: school funds, outside grants, or sponsors.");
    }
    await client.query(
      `UPDATE organizations
       SET city = $2,
           state_prov = $3,
           description = $4,
           team_affiliation = $5,
           school_funded = $6,
           outside_grants = $7,
           sponsors_allowed = $8
       WHERE id = $1::uuid`,
      [
        state.lockedOrgId,
        location.city,
        location.stateProv,
        location.description,
        payload.teamAffiliation,
        schoolFunded,
        outsideGrants,
        sponsorsAllowed,
      ],
    );
  }

  await client.query(
    `INSERT INTO profiles(
       user_id, first_name, last_name, date_of_birth, gender,
       preferred_team_number, team_role, crew_role, role_description, primary_focus, display_name, theme_preference,
       onboarding_current_step, onboarding_started_at, onboarding_saved_at, onboarding_completed_at
     ) VALUES ($1,$2,$3,$4::date,$5,$6,$7,$8,$9,$10,$11,$12,'complete',COALESCE($13::timestamptz,now()),now(),now())
     ON CONFLICT (user_id) DO UPDATE SET
       first_name = excluded.first_name,
       last_name = excluded.last_name,
       date_of_birth = excluded.date_of_birth,
       gender = excluded.gender,
       preferred_team_number = excluded.preferred_team_number,
       team_role = excluded.team_role,
       crew_role = excluded.crew_role,
       role_description = excluded.role_description,
       primary_focus = excluded.primary_focus,
       display_name = excluded.display_name,
       theme_preference = excluded.theme_preference,
       onboarding_current_step = 'complete',
       onboarding_started_at = COALESCE(profiles.onboarding_started_at, excluded.onboarding_started_at),
       onboarding_saved_at = now(),
       onboarding_completed_at = COALESCE(profiles.onboarding_completed_at, now())`,
    [
      userId,
      payload.firstName,
      payload.lastName,
      payload.dateOfBirth,
      payload.gender,
      teamNumber,
      serializeRoleList(payload.teamRoles?.length ? payload.teamRoles : parseTeamRoles(payload.teamRole)),
      serializeRoleList(payload.crewRoles?.length ? payload.crewRoles : parseCrewRoles(payload.crewRole)),
      payload.roleDescription,
      payload.primaryFocus,
      payload.displayName,
      payload.themePreference,
      state.startedAt,
    ],
  );

  await recordLegalAcceptance(client, userId);

  await client.query(`UPDATE users SET name=$2 WHERE id=$1`, [
    userId,
    payload.displayName || `${payload.firstName} ${payload.lastName}`,
  ]);

  if (
    teamNumber != null &&
    !state.platformAdmin &&
    ["none", "declined", "withdrawn"].includes(state.accessStatus)
  ) {
    try {
      await client.query(`SELECT request_workspace_access($1,$2,$3,$4,$5)`, [
        teamNumber,
        payload.teamRole,
        payload.primaryFocus,
        payload.crewRole,
        payload.roleDescription,
      ]);
    } catch (error) {
      if (!isMissingWorkspaceError(error)) throw error;
    }
  }

  return getOnboardingState(client, userId);
}

/** Lightweight gate for proxy/middleware: profile complete + workspace membership. */
export async function getOnboardingGate(client: PoolClient, userId: string) {
  const complete = await isOnboardingComplete(client, userId);
  const membership = await client.query(
    `SELECT 1 FROM memberships WHERE user_id=$1::uuid LIMIT 1`,
    [userId],
  );
  const admin = await client.query(`SELECT 1 FROM platform_admins WHERE user_id=$1::uuid`, [userId]);
  const hasWorkspace = Boolean(membership.rowCount) || Boolean(admin.rowCount);
  return {
    onboardingComplete: complete,
    workspaceApproved: hasWorkspace,
    accessStatus: hasWorkspace ? ("approved" as const) : ("none" as const),
  };
}
