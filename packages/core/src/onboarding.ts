import type { PoolClient } from "@neondatabase/serverless";

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

export type GenderOption = (typeof GENDER_OPTIONS)[number];
export type TeamRoleOption = (typeof TEAM_ROLE_OPTIONS)[number];

export type OrgLocationInput = {
  city?: string | null;
  stateProv?: string | null;
  description?: string | null;
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
  preferredTeamNumber: number;
  teamRole?: TeamRoleOption | null;
  displayName?: string | null;
  themePreference?: "light" | "dark";
  city?: string | null;
  stateProv?: string | null;
  description?: string | null;
};

export type OnboardingState = {
  complete: boolean;
  firstName: string | null;
  lastName: string | null;
  dateOfBirth: string | null;
  gender: string | null;
  preferredTeamNumber: number | null;
  teamRole: string | null;
  displayName: string | null;
  themePreference: "light" | "dark";
  lockedTeamNumber: number | null;
  lockedOrgName: string | null;
  lockedOrgId: string | null;
  isTeamHead: boolean;
  orgCity: string | null;
  orgStateProv: string | null;
  orgDescription: string | null;
  canCreateOrg: boolean;
  platformAdmin: boolean;
};

function trimOrNull(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.slice(0, max);
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
  const firstName = input.firstName.trim();
  const lastName = input.lastName.trim();
  if (firstName.length < 1 || firstName.length > 60) throw new Error("First name is required (max 60 characters).");
  if (lastName.length < 1 || lastName.length > 60) throw new Error("Last name is required (max 60 characters).");
  if (!GENDER_OPTIONS.includes(input.gender)) throw new Error("Select a gender option.");
  const teamNumber = Number(input.preferredTeamNumber);
  if (!Number.isInteger(teamNumber) || teamNumber < 1 || teamNumber > 99999) {
    throw new Error("FRC team number must be between 1 and 99999.");
  }
  if (input.teamRole != null && !TEAM_ROLE_OPTIONS.includes(input.teamRole)) {
    throw new Error("Select a valid team role.");
  }
  const displayName = input.displayName?.trim() || `${firstName} ${lastName}`.trim();
  if (displayName.length > 80) throw new Error("Display name must be 80 characters or fewer.");
  const themePreference = input.themePreference === "dark" ? "dark" : "light";
  parseDob(input.dateOfBirth);
  const location = normalizeOrgLocationFields(input, { requireLocation: false });
  return {
    firstName,
    lastName,
    dateOfBirth: input.dateOfBirth.trim(),
    gender: input.gender,
    preferredTeamNumber: teamNumber,
    teamRole: input.teamRole || null,
    displayName,
    themePreference,
    city: location.city,
    stateProv: location.stateProv,
    description: location.description,
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
    displayName: string | null;
    themePreference: string | null;
    onboardingCompletedAt: string | null;
  }>(
    `SELECT first_name AS "firstName",
            last_name AS "lastName",
            date_of_birth::text AS "dateOfBirth",
            gender,
            preferred_team_number AS "preferredTeamNumber",
            team_role AS "teamRole",
            display_name AS "displayName",
            theme_preference AS "themePreference",
            onboarding_completed_at::text AS "onboardingCompletedAt"
     FROM profiles WHERE user_id=$1`,
    [userId],
  );
  const admin = await client.query(`SELECT 1 FROM platform_admins WHERE user_id=$1`, [userId]);
  const membership = await client.query<LockedOrgRow>(
    `SELECT o.id AS "orgId",
            o.team_number AS "teamNumber",
            o.name AS "orgName",
            m.role::text AS "role",
            o.city,
            o.state_prov AS "stateProv",
            o.description
     FROM memberships m
     JOIN organizations o ON o.id = m.org_id
     WHERE m.user_id=$1 AND o.team_number IS NOT NULL
     ORDER BY CASE m.role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END
     LIMIT 1`,
    [userId],
  );
  const pendingInvite = !membership.rows[0]
    ? await client.query<LockedOrgRow>(
        `SELECT o.id AS "orgId",
                o.team_number AS "teamNumber",
                o.name AS "orgName",
                NULL::text AS "role",
                o.city,
                o.state_prov AS "stateProv",
                o.description
         FROM invites i
         JOIN organizations o ON o.id = i.org_id
         JOIN users u ON lower(u.email) = lower(i.email)
         WHERE u.id=$1 AND i.status='pending' AND i.expires_at > now() AND o.team_number IS NOT NULL
         ORDER BY i.created_at DESC
         LIMIT 1`,
        [userId],
      )
    : { rows: [] as LockedOrgRow[] };

  const locked = membership.rows[0] ?? pendingInvite.rows[0] ?? null;
  const row = profile.rows[0];
  return {
    complete: Boolean(row?.onboardingCompletedAt),
    firstName: row?.firstName ?? null,
    lastName: row?.lastName ?? null,
    dateOfBirth: row?.dateOfBirth ?? null,
    gender: row?.gender ?? null,
    preferredTeamNumber: row?.preferredTeamNumber ?? locked?.teamNumber ?? null,
    teamRole: row?.teamRole ?? null,
    displayName: row?.displayName ?? null,
    themePreference: row?.themePreference === "dark" ? "dark" : "light",
    lockedTeamNumber: locked?.teamNumber ?? null,
    lockedOrgName: locked?.orgName ?? null,
    lockedOrgId: locked?.orgId ?? null,
    isTeamHead: isTeamHeadRole(locked?.role),
    orgCity: locked?.city ?? null,
    orgStateProv: locked?.stateProv ?? null,
    orgDescription: locked?.description ?? null,
    canCreateOrg: Boolean(admin.rowCount),
    platformAdmin: Boolean(admin.rowCount),
  };
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
  if (state.complete) return state;

  const payload = validateOnboardingPayload(input);
  const teamNumber =
    state.lockedTeamNumber != null ? state.lockedTeamNumber : payload.preferredTeamNumber;

  if (state.isTeamHead && state.lockedOrgId) {
    const location = normalizeOrgLocationFields(input, { requireLocation: true });
    await client.query(
      `UPDATE organizations
       SET city = $2,
           state_prov = $3,
           description = $4
       WHERE id = $1::uuid`,
      [state.lockedOrgId, location.city, location.stateProv, location.description],
    );
  }

  await client.query(
    `INSERT INTO profiles(
       user_id, first_name, last_name, date_of_birth, gender,
       preferred_team_number, team_role, display_name, theme_preference, onboarding_completed_at
     ) VALUES ($1,$2,$3,$4::date,$5,$6,$7,$8,$9,now())
     ON CONFLICT (user_id) DO UPDATE SET
       first_name = excluded.first_name,
       last_name = excluded.last_name,
       date_of_birth = excluded.date_of_birth,
       gender = excluded.gender,
       preferred_team_number = excluded.preferred_team_number,
       team_role = excluded.team_role,
       display_name = excluded.display_name,
       theme_preference = excluded.theme_preference,
       onboarding_completed_at = COALESCE(profiles.onboarding_completed_at, now())`,
    [
      userId,
      payload.firstName,
      payload.lastName,
      payload.dateOfBirth,
      payload.gender,
      teamNumber,
      payload.teamRole,
      payload.displayName,
      payload.themePreference,
    ],
  );

  await client.query(`UPDATE users SET name=$2 WHERE id=$1`, [
    userId,
    payload.displayName || `${payload.firstName} ${payload.lastName}`,
  ]);

  return getOnboardingState(client, userId);
}

/** Lightweight gate for proxy/middleware: profile complete + workspace membership. */
export async function getOnboardingGate(client: PoolClient, userId: string) {
  const complete = await isOnboardingComplete(client, userId);
  const membership = await client.query(
    `SELECT 1 FROM organization_memberships WHERE user_id=$1::uuid LIMIT 1`,
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
