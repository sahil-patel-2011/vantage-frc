import type { PoolClient } from "@neondatabase/serverless";
import { summarizeAlumniNetwork } from ".";
import type {
  AlumniProfile,
  AlumniStatus,
  AlumniSummary,
  MentorSlot,
  MentorSlotStatus,
  TeamDirectoryAlum,
} from "./types";

export const ALUMNI_STATUSES: AlumniStatus[] = ["active", "inactive"];
export const MENTOR_SLOT_STATUSES: MentorSlotStatus[] = ["open", "booked", "completed", "cancelled"];

export type AlumniSetupStep = {
  id: string;
  label: string;
  detail: string;
  href: string;
};

export type AlumniNetworkView =
  | {
      status: "setup_required";
      message: string;
      steps: AlumniSetupStep[];
      orgId: string | null;
    }
  | {
      status: "live";
      orgId: string;
      teamNumber: number | null;
      profiles: AlumniProfile[];
      mentorSlots: MentorSlot[];
      summary: AlumniSummary;
      /** Alumni already in the team's shared directory (team_alumni) not yet imported here. */
      teamDirectory: TeamDirectoryAlum[];
      computedAt: string;
    };

type ProfileRow = {
  id: string;
  fullName: string;
  graduationYear: number | null;
  roleWhileActive: string | null;
  currentOccupation: string | null;
  currentLocation: string | null;
  email: string | null;
  phone: string | null;
  linkedinUrl: string | null;
  mentorAvailable: boolean;
  mentorFocusAreas: string[] | null;
  bio: string | null;
  status: AlumniStatus;
  createdAt: string;
};

type SlotRow = {
  id: string;
  profileId: string;
  profileName: string;
  topic: string;
  availableFrom: string;
  availableTo: string | null;
  notes: string | null;
  status: MentorSlotStatus;
  createdAt: string;
};

type TeamAlumRow = {
  id: string;
  fullName: string;
  gradYear: number | null;
  currentRole: string | null;
  email: string | null;
  linkedinUrl: string | null;
  isMentor: boolean;
  mentorTopic: string | null;
};

function mapTeamAlum(row: TeamAlumRow): TeamDirectoryAlum {
  return {
    id: row.id,
    fullName: row.fullName,
    gradYear: row.gradYear,
    currentRole: row.currentRole,
    email: row.email,
    linkedinUrl: row.linkedinUrl,
    isMentor: row.isMentor,
    mentorTopic: row.mentorTopic,
  };
}

function mapProfile(row: ProfileRow): AlumniProfile {
  return {
    id: row.id,
    fullName: row.fullName,
    graduationYear: row.graduationYear,
    roleWhileActive: row.roleWhileActive,
    currentOccupation: row.currentOccupation,
    currentLocation: row.currentLocation,
    email: row.email,
    phone: row.phone,
    linkedinUrl: row.linkedinUrl,
    mentorAvailable: row.mentorAvailable,
    mentorFocusAreas: Array.isArray(row.mentorFocusAreas) ? row.mentorFocusAreas : [],
    bio: row.bio,
    status: row.status,
    createdAt: row.createdAt,
  };
}

function mapSlot(row: SlotRow): MentorSlot {
  return {
    id: row.id,
    profileId: row.profileId,
    profileName: row.profileName,
    topic: row.topic,
    availableFrom: row.availableFrom,
    availableTo: row.availableTo,
    notes: row.notes,
    status: row.status,
    createdAt: row.createdAt,
  };
}

async function resolveOrg(
  client: PoolClient,
  userId: string,
  requestedOrg: string | null,
): Promise<{ orgId: string; teamNumber: number | null } | null> {
  const membership = await client.query<{ orgId: string; teamNumber: number | null }>(
    `SELECT m.org_id AS "orgId", o.team_number AS "teamNumber"
     FROM memberships m
     JOIN organizations o ON o.id = m.org_id
     WHERE m.user_id = $1
       AND ($2::uuid IS NULL OR m.org_id = $2::uuid)
     ORDER BY CASE m.role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END, o.team_number
     LIMIT 1`,
    [userId, requestedOrg],
  );
  return membership.rows[0] ?? null;
}

export async function computeAlumniNetworkView(
  client: PoolClient,
  input: { userId: string; requestedOrg: string | null },
): Promise<AlumniNetworkView> {
  const org = await resolveOrg(client, input.userId, input.requestedOrg);

  if (!org) {
    return {
      status: "setup_required",
      message: "Select a team workspace to build your alumni network directory.",
      steps: [
        { id: "workspace", label: "Select workspace", detail: "Choose your team organization", href: "/workspace" },
      ],
      orgId: null,
    };
  }

  const [profileResult, slotResult, directoryResult] = await Promise.all([
    client.query<ProfileRow>(
      `SELECT id, full_name AS "fullName", graduation_year AS "graduationYear",
              role_while_active AS "roleWhileActive", current_occupation AS "currentOccupation",
              current_location AS "currentLocation", email, phone, linkedin_url AS "linkedinUrl",
              mentor_available AS "mentorAvailable", mentor_focus_areas AS "mentorFocusAreas",
              bio, status, created_at::text AS "createdAt"
       FROM alumni_network_profiles
       WHERE org_id = $1
       ORDER BY full_name ASC`,
      [org.orgId],
    ),
    client.query<SlotRow>(
      `SELECT s.id, s.profile_id AS "profileId", p.full_name AS "profileName", s.topic,
              s.available_from::text AS "availableFrom", s.available_to::text AS "availableTo",
              s.notes, s.status, s.created_at::text AS "createdAt"
       FROM alumni_network_mentor_slots s
       JOIN alumni_network_profiles p ON p.id = s.profile_id
       WHERE s.org_id = $1
       ORDER BY s.available_from DESC, s.created_at DESC`,
      [org.orgId],
    ),
    // Ground the directory in the team's existing shared alumni list (team_alumni, mig 0113/0135):
    // surface entries not already imported into the richer profile table so teams don't re-key them.
    client.query<TeamAlumRow>(
      `SELECT ta.id, ta.full_name AS "fullName", ta.grad_year AS "gradYear",
              ta.current_role AS "currentRole", ta.email, ta.linkedin_url AS "linkedinUrl",
              ta.is_mentor AS "isMentor", ta.mentor_topic AS "mentorTopic"
       FROM team_alumni ta
       WHERE ta.org_id = $1
         AND NOT EXISTS (
           SELECT 1 FROM alumni_network_profiles p
           WHERE p.org_id = ta.org_id AND lower(p.full_name) = lower(ta.full_name)
         )
       ORDER BY ta.grad_year DESC NULLS LAST, ta.full_name ASC`,
      [org.orgId],
    ),
  ]);

  const profiles = profileResult.rows.map(mapProfile);
  const mentorSlots = slotResult.rows.map(mapSlot);
  const summary = summarizeAlumniNetwork(profiles, mentorSlots);
  const teamDirectory = directoryResult.rows.map(mapTeamAlum);

  return {
    status: "live",
    orgId: org.orgId,
    teamNumber: org.teamNumber,
    profiles,
    mentorSlots,
    summary,
    teamDirectory,
    computedAt: new Date().toISOString(),
  };
}

// ---- write helpers (run inside the caller's withRls transaction) ----

export async function addProfile(
  client: PoolClient,
  input: {
    orgId: string;
    userId: string;
    fullName: string;
    graduationYear: number | null;
    roleWhileActive: string | null;
    currentOccupation: string | null;
    currentLocation: string | null;
    email: string | null;
    phone: string | null;
    linkedinUrl: string | null;
    mentorAvailable: boolean;
    mentorFocusAreas: string[];
    bio: string | null;
    status: AlumniStatus;
  },
): Promise<void> {
  await client.query(
    `INSERT INTO alumni_network_profiles (
       org_id, full_name, graduation_year, role_while_active, current_occupation,
       current_location, email, phone, linkedin_url, mentor_available, mentor_focus_areas,
       bio, status, added_by
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::text[],$12,$13,$14)`,
    [
      input.orgId,
      input.fullName,
      input.graduationYear,
      input.roleWhileActive,
      input.currentOccupation,
      input.currentLocation,
      input.email,
      input.phone,
      input.linkedinUrl,
      input.mentorAvailable,
      input.mentorFocusAreas,
      input.bio,
      input.status,
      input.userId,
    ],
  );
}

export async function updateProfile(
  client: PoolClient,
  input: { orgId: string; profileId: string; mentorAvailable: boolean; status: AlumniStatus },
): Promise<void> {
  await client.query(
    `UPDATE alumni_network_profiles SET mentor_available = $3, status = $4
     WHERE id = $1 AND org_id = $2`,
    [input.profileId, input.orgId, input.mentorAvailable, input.status],
  );
}

export async function deleteProfile(
  client: PoolClient,
  input: { orgId: string; profileId: string },
): Promise<void> {
  await client.query(`DELETE FROM alumni_network_profiles WHERE id = $1 AND org_id = $2`, [
    input.profileId,
    input.orgId,
  ]);
}

export async function addMentorSlot(
  client: PoolClient,
  input: {
    orgId: string;
    userId: string;
    profileId: string;
    topic: string;
    availableFrom: string;
    availableTo: string | null;
    notes: string | null;
  },
): Promise<void> {
  await client.query(
    `INSERT INTO alumni_network_mentor_slots (
       org_id, profile_id, topic, available_from, available_to, notes, created_by
     ) VALUES ($1,$2,$3,$4::date,$5::date,$6,$7)`,
    [
      input.orgId,
      input.profileId,
      input.topic,
      input.availableFrom,
      input.availableTo,
      input.notes,
      input.userId,
    ],
  );
}

export async function updateMentorSlotStatus(
  client: PoolClient,
  input: { orgId: string; slotId: string; status: MentorSlotStatus },
): Promise<void> {
  await client.query(`UPDATE alumni_network_mentor_slots SET status = $3 WHERE id = $1 AND org_id = $2`, [
    input.slotId,
    input.orgId,
    input.status,
  ]);
}

export async function deleteMentorSlot(
  client: PoolClient,
  input: { orgId: string; slotId: string },
): Promise<void> {
  await client.query(`DELETE FROM alumni_network_mentor_slots WHERE id = $1 AND org_id = $2`, [
    input.slotId,
    input.orgId,
  ]);
}
