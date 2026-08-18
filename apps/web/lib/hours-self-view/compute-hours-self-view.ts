import type { PoolClient } from "@neondatabase/serverless";
import { evaluateBiometricGate, minutesBetween, summarizeHoursSelfEntries, summarizeWhoIsHere } from ".";
import type {
  BiometricConsentRecord,
  BiometricConsentStatus,
  BiometricGate,
  HourLogKind,
  HoursSelfEntry,
  HoursSelfSummary,
  KioskSessionStatus,
  ShopPresence,
} from "./types";

export type HoursSelfViewSetupStep = {
  id: string;
  label: string;
  detail: string;
  href: string;
};

export type HoursSelfViewView =
  | {
      status: "setup_required";
      message: string;
      steps: HoursSelfViewSetupStep[];
      orgId: string | null;
    }
  | {
      status: "live";
      orgId: string;
      teamNumber: number | null;
      userId: string;
      entries: HoursSelfEntry[];
      summary: HoursSelfSummary;
      kioskSessions: KioskSessionStatus[];
      presentNow: ShopPresence[];
      biometricConsent: BiometricConsentRecord | null;
      biometricGate: BiometricGate;
      computedAt: string;
    };

function isHourLogKind(value: unknown): value is HourLogKind {
  return typeof value === "string" && ["build", "meeting", "outreach", "competition", "other"].includes(value);
}

type HourLogRow = {
  id: string;
  kind: string;
  clockIn: string;
  clockOut: string | null;
  note: string | null;
};

function mapEntry(row: HourLogRow): HoursSelfEntry {
  return {
    id: row.id,
    kind: isHourLogKind(row.kind) ? row.kind : "other",
    clockIn: row.clockIn,
    clockOut: row.clockOut,
    minutes: minutesBetween(row.clockIn, row.clockOut),
    note: row.note ?? "",
  };
}

type KioskRow = {
  id: string;
  deviceLabel: string;
  isLocked: boolean;
  lastActiveAt: string | null;
  createdAt: string;
};

function mapKiosk(row: KioskRow): KioskSessionStatus {
  return {
    id: row.id,
    deviceLabel: row.deviceLabel,
    isLocked: Boolean(row.isLocked),
    lastActiveAt: row.lastActiveAt,
    createdAt: row.createdAt,
  };
}

type ConsentRow = {
  isMinor: boolean;
  consentStatus: string;
  guardianName: string | null;
  recordedAt: string;
};

function isConsentStatus(value: unknown): value is BiometricConsentStatus {
  return typeof value === "string" && ["pending", "granted", "denied"].includes(value);
}

function mapConsent(row: ConsentRow): BiometricConsentRecord {
  return {
    isMinor: Boolean(row.isMinor),
    status: isConsentStatus(row.consentStatus) ? row.consentStatus : "pending",
    guardianName: row.guardianName,
    recordedAt: row.recordedAt,
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

export async function computeHoursSelfViewView(
  client: PoolClient,
  input: { userId: string; requestedOrg: string | null },
): Promise<HoursSelfViewView> {
  const org = await resolveOrg(client, input.userId, input.requestedOrg);

  if (!org) {
    return {
      status: "setup_required",
      message: "Select a team workspace to view your own hours.",
      steps: [
        { id: "workspace", label: "Select workspace", detail: "Choose your team organization", href: "/workspace" },
      ],
      orgId: null,
    };
  }

  const [entryResult, kioskResult, consentResult, presentResult] = await Promise.all([
    client.query<HourLogRow>(
      `SELECT id, kind, clock_in::text AS "clockIn", clock_out::text AS "clockOut", note
       FROM hour_logs
       WHERE org_id = $1 AND user_id = $2
       ORDER BY clock_in DESC
       LIMIT 200`,
      [org.orgId, input.userId],
    ),
    client.query<KioskRow>(
      `SELECT id, device_label AS "deviceLabel", is_locked AS "isLocked",
              last_active_at::text AS "lastActiveAt", created_at::text AS "createdAt"
       FROM hours_self_view_kiosk_sessions
       WHERE org_id = $1
       ORDER BY created_at DESC
       LIMIT 50`,
      [org.orgId],
    ),
    client.query<ConsentRow>(
      `SELECT is_minor AS "isMinor", consent_status AS "consentStatus",
              guardian_name AS "guardianName", recorded_at::text AS "recordedAt"
       FROM hours_self_view_biometric_consents
       WHERE org_id = $1 AND user_id = $2
       LIMIT 1`,
      [org.orgId, input.userId],
    ),
    client.query<{ userId: string; displayName: string; kind: string; clockIn: string }>(
      `SELECT h.user_id AS "userId",
              COALESCE(NULLIF(trim(u.name), ''), 'Member') AS "displayName",
              h.kind,
              h.clock_in::text AS "clockIn"
       FROM hour_logs h
       LEFT JOIN users u ON u.id = h.user_id
       WHERE h.org_id = $1 AND h.clock_out IS NULL
       ORDER BY h.clock_in`,
      [org.orgId],
    ),
  ]);

  const entries = entryResult.rows.map(mapEntry);
  const summary = summarizeHoursSelfEntries(entries);
  const kioskSessions = kioskResult.rows.map(mapKiosk);
  const presentNow = summarizeWhoIsHere(
    presentResult.rows.map((row) => ({
      userId: row.userId,
      displayName: row.displayName,
      kind: isHourLogKind(row.kind) ? row.kind : "other",
      clockIn: row.clockIn,
    })),
    new Date().toISOString(),
  );
  const biometricConsent = consentResult.rows[0] ? mapConsent(consentResult.rows[0]) : null;
  const biometricGate = evaluateBiometricGate(biometricConsent);

  return {
    status: "live",
    orgId: org.orgId,
    teamNumber: org.teamNumber,
    userId: input.userId,
    entries,
    summary,
    kioskSessions,
    presentNow,
    biometricConsent,
    biometricGate,
    computedAt: new Date().toISOString(),
  };
}

// ---- write helpers (run inside the caller's withRls transaction) ----

export async function recordBiometricConsent(
  client: PoolClient,
  input: {
    orgId: string;
    userId: string;
    subjectUserId: string;
    isMinor: boolean;
    status: BiometricConsentStatus;
    guardianName: string | null;
  },
): Promise<void> {
  await client.query(
    `INSERT INTO hours_self_view_biometric_consents (
       org_id, user_id, is_minor, consent_status, guardian_name, recorded_by
     ) VALUES ($1,$2,$3,$4,$5,$6)
     ON CONFLICT (org_id, user_id) DO UPDATE SET
       is_minor = EXCLUDED.is_minor,
       consent_status = EXCLUDED.consent_status,
       guardian_name = EXCLUDED.guardian_name,
       recorded_by = EXCLUDED.recorded_by,
       recorded_at = now()`,
    [input.orgId, input.subjectUserId, input.isMinor, input.status, input.guardianName, input.userId],
  );
}

export async function registerKioskSession(
  client: PoolClient,
  input: { orgId: string; userId: string; deviceLabel: string },
): Promise<void> {
  await client.query(
    `INSERT INTO hours_self_view_kiosk_sessions (org_id, device_label, is_locked, created_by)
     VALUES ($1,$2,true,$3)`,
    [input.orgId, input.deviceLabel, input.userId],
  );
}

export async function setKioskLock(
  client: PoolClient,
  input: { orgId: string; kioskId: string; isLocked: boolean },
): Promise<void> {
  await client.query(
    `UPDATE hours_self_view_kiosk_sessions
     SET is_locked = $1, last_active_at = now()
     WHERE id = $2 AND org_id = $3`,
    [input.isLocked, input.kioskId, input.orgId],
  );
}

export async function deleteKioskSession(
  client: PoolClient,
  input: { orgId: string; kioskId: string },
): Promise<void> {
  await client.query(`DELETE FROM hours_self_view_kiosk_sessions WHERE id = $1 AND org_id = $2`, [
    input.kioskId,
    input.orgId,
  ]);
}
