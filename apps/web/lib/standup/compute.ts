/**
 * Load the standup digest from canonical work items and closed hour_logs.
 *
 * Empty until a date has real hours or in-window task movement. Open blockers
 * can appear on a live digest but never fabricate a day of work by themselves.
 */

import type { PoolClient } from "@neondatabase/serverless";
import { loadWorkItems } from "../work-items/service";
import {
  compileDigest,
  defaultDigestDate,
  digestHasWork,
  isDigestDate,
  windowForDate,
} from "./digest";
import type { StandupDigest, StandupSetupStep } from "./types";

export type StandupView =
  | {
      status: "setup_required";
      message: string;
      steps: StandupSetupStep[];
      orgId: null;
      digestDate: string;
    }
  | {
      status: "empty";
      message: string;
      steps: StandupSetupStep[];
      orgId: string;
      teamNumber: number | null;
      digestDate: string;
      standingBlockers: number;
      computedAt: string;
    }
  | {
      status: "live";
      orgId: string;
      teamNumber: number | null;
      digestDate: string;
      digest: StandupDigest;
      computedAt: string;
    };

const WORKSPACE_STEP: StandupSetupStep = {
  id: "workspace",
  label: "Choose your team",
  detail: "Pick which FRC team you are working as.",
  href: "/workspace",
};

const EMPTY_STEPS: StandupSetupStep[] = [
  {
    id: "hours",
    label: "Log hours",
    detail: "Clock in on Hours so shop time appears in this digest.",
    href: "/hours",
  },
  {
    id: "work",
    label: "Track work",
    detail: "Create or complete a task on Work.",
    href: "/todos",
  },
];

async function resolveOrg(
  client: PoolClient,
  userId: string,
  requestedOrg: string | null,
): Promise<{ orgId: string; teamNumber: number | null } | null> {
  const membership = await client.query<{ orgId: string; teamNumber: number | null }>(
    `SELECT m.org_id AS "orgId", o.team_number AS "teamNumber"
     FROM memberships m
     JOIN organizations o ON o.id = m.org_id
     WHERE m.user_id = $1::uuid
       AND ($2::uuid IS NULL OR m.org_id = $2::uuid)
     ORDER BY CASE m.role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END, o.team_number
     LIMIT 1`,
    [userId, requestedOrg],
  );
  return membership.rows[0] ?? null;
}

type HourRow = { userId: string; name: string; kind: string; hours: number };

async function loadClosedHours(
  client: PoolClient,
  orgId: string,
  windowStart: string,
  windowEnd: string,
): Promise<HourRow[]> {
  try {
    const result = await client.query<HourRow>(
      `SELECT h.user_id::text AS "userId",
              COALESCE(NULLIF(trim(u.name), ''), u.email) AS name,
              h.kind,
              extract(epoch FROM (h.clock_out - h.clock_in)) / 3600.0 AS hours
       FROM hour_logs h
       JOIN users u ON u.id = h.user_id
       WHERE h.org_id = $1::uuid
         AND h.clock_out IS NOT NULL
         AND h.clock_in >= $2::timestamptz
         AND h.clock_in < $3::timestamptz`,
      [orgId, windowStart, windowEnd],
    );
    return result.rows.map((row) => ({
      ...row,
      hours: Number(row.hours) || 0,
    }));
  } catch {
    return [];
  }
}

export async function computeStandupView(
  client: PoolClient,
  input: { userId: string; requestedOrg: string | null; digestDate?: string | null },
): Promise<StandupView> {
  const digestDate = isDigestDate(input.digestDate) ? input.digestDate : defaultDigestDate();
  const org = await resolveOrg(client, input.userId, input.requestedOrg);

  if (!org) {
    return {
      status: "setup_required",
      message: "Select a team to see the morning standup digest.",
      steps: [WORKSPACE_STEP],
      orgId: null,
      digestDate,
    };
  }

  const { windowStart, windowEnd } = windowForDate(digestDate);
  const [{ items }, hourRows] = await Promise.all([
    loadWorkItems(client, { orgId: org.orgId, asOf: digestDate }),
    loadClosedHours(client, org.orgId, windowStart, windowEnd),
  ]);

  const digest = compileDigest({
    digestDate,
    items,
    hourRows,
    asOf: new Date(`${digestDate}T23:59:59.000Z`),
  });

  const computedAt = new Date().toISOString();

  if (!digestHasWork(digest)) {
    return {
      status: "empty",
      message: "Nothing logged for this date yet. The digest stays empty until hours or task movement exist.",
      steps: EMPTY_STEPS,
      orgId: org.orgId,
      teamNumber: org.teamNumber,
      digestDate,
      standingBlockers: digest.blockers.length,
      computedAt,
    };
  }

  return {
    status: "live",
    orgId: org.orgId,
    teamNumber: org.teamNumber,
    digestDate,
    digest,
    computedAt,
  };
}
