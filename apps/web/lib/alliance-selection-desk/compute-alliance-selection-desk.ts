// Alliance Selection Desk — the draft board. It keeps its own session / slot / evidence rows
// (evidence FKs to a slot), but the answer to "which team is in this slot" now comes from the ONE
// pick list: pick_list_entries.drafted_alliance_seed / drafted_pick_slot (migration 0454). Placing
// a team here therefore moves the collaborative list and takes the team out of Pick Clock, and the
// justifier's rationale rides along on the same row.

import type { PoolClient } from "@neondatabase/serverless";
import { boardState, ensurePickList, setBoardSlot, type BoardSlot } from "../picklist";
import { hubHref } from "../nav/hubs";
import {
  detectDeskConflicts,
  groupSlotsByAlliance,
  normalizeTeamKey,
  teamNumberFromKey,
} from ".";
import type {
  DeskAlliance,
  DeskEvidence,
  DeskEvidenceKind,
  DeskExportSnapshot,
  DeskMember,
  DeskPickSlot,
  DeskSessionStatus,
  DeskSessionSummary,
  DeskSetupStep,
  DeskSlot,
} from "./types";

export type AllianceSelectionDeskView =
  | {
      status: "setup_required";
      message: string;
      steps: DeskSetupStep[];
      orgId: string | null;
      eventKey: string | null;
    }
  | {
      status: "empty";
      message: string;
      steps: DeskSetupStep[];
      orgId: string;
      eventKey: string;
      eventName: string | null;
      teamNumber: number | null;
      sessions: DeskSessionSummary[];
      members: DeskMember[];
    }
  | {
      status: "live";
      orgId: string;
      eventKey: string;
      eventName: string | null;
      teamNumber: number | null;
      canEdit: boolean;
      session: {
        id: string;
        name: string;
        status: DeskSessionStatus;
        notes: string;
        updatedAt: string;
      };
      sessions: DeskSessionSummary[];
      alliances: DeskAlliance[];
      conflictCount: number;
      members: DeskMember[];
      recentExports: Array<{ id: string; createdAt: string; createdByName: string | null }>;
      computedAt: string;
    };

type SessionRow = {
  id: string;
  name: string;
  status: DeskSessionStatus;
  notes: string;
  eventKey: string;
  updatedAt: string;
  linkedPickListId: string | null;
};

type SlotRow = {
  id: string;
  allianceSeed: number;
  pickSlot: DeskPickSlot;
  teamKey: string | null;
  rationale: string;
  sortOrder: number;
};

type EvidenceRow = {
  id: string;
  slotId: string;
  sourceKind: DeskEvidenceKind;
  matchScoutEntryId: string | null;
  pitScoutEntryId: string | null;
  note: string;
  createdBy: string;
  createdByName: string | null;
  createdAt: string;
};

type MetricRow = {
  teamKey: string;
  rank: number | null;
  epaTotal: number | null;
};

type ScoutCountRow = {
  teamKey: string;
  matchCount: string;
  pitCount: string;
};

const PICK_SLOTS: DeskPickSlot[] = ["captain", "first", "second"];

async function resolveOrg(
  client: PoolClient,
  userId: string,
  requestedOrg: string | null,
): Promise<{
  orgId: string;
  teamNumber: number | null;
  eventKey: string | null;
  eventName: string | null;
  role: string;
} | null> {
  const result = await client.query<{
    orgId: string;
    teamNumber: number | null;
    eventKey: string | null;
    eventName: string | null;
    role: string;
  }>(
    `SELECT m.org_id AS "orgId", o.team_number AS "teamNumber",
            c.active_event_key AS "eventKey", e.name AS "eventName", m.role::text AS role
     FROM memberships m
     JOIN organizations o ON o.id = m.org_id
     LEFT JOIN org_active_context c ON c.org_id = o.id
     LEFT JOIN events_ref e ON e.event_key = c.active_event_key
     WHERE m.user_id = $1
       AND ($2::uuid IS NULL OR m.org_id = $2::uuid)
     ORDER BY CASE m.role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END, o.team_number
     LIMIT 1`,
    [userId, requestedOrg],
  );
  return result.rows[0] ?? null;
}

function setupSteps(orgId: string | null, eventKey: string | null): DeskSetupStep[] {
  return [
    {
      id: "workspace",
      label: "Select workspace",
      detail: "Choose your team organization",
      href: "/workspace",
      done: Boolean(orgId),
    },
    {
      id: "event",
      label: "Set active event",
      detail: "Alliance selection needs a TBA event context",
      href: hubHref("/competition", "command", orgId),
      done: Boolean(eventKey),
    },
    {
      id: "scouting",
      label: "Scout opponents",
      detail: "Attach match/pit evidence to picks — never DEMO ranks",
      href: hubHref("/competition", "scouting", orgId),
      done: false,
    },
  ];
}

async function loadMembers(client: PoolClient, orgId: string): Promise<DeskMember[]> {
  const result = await client.query<DeskMember>(
    `SELECT m.user_id AS "userId", u.name, u.email
     FROM memberships m
     JOIN users u ON u.id = m.user_id
     WHERE m.org_id = $1
     ORDER BY u.name NULLS LAST, u.email
     LIMIT 80`,
    [orgId],
  );
  return result.rows;
}

async function loadSessions(
  client: PoolClient,
  orgId: string,
  eventKey: string,
): Promise<DeskSessionSummary[]> {
  const result = await client.query<SessionRow>(
    `SELECT id, name, status, notes, event_key AS "eventKey", updated_at::text AS "updatedAt",
            linked_pick_list_id AS "linkedPickListId"
     FROM alliance_selection_desk_sessions
     WHERE org_id = $1 AND event_key = $2
     ORDER BY updated_at DESC`,
    [orgId, eventKey],
  );
  return result.rows.map((row) => ({
    id: row.id,
    name: row.name,
    status: row.status,
    eventKey: row.eventKey,
    updatedAt: row.updatedAt,
  }));
}

async function seedDefaultSlots(client: PoolClient, orgId: string, sessionId: string): Promise<void> {
  const values: unknown[] = [];
  const parts: string[] = [];
  let i = 1;
  for (let seed = 1; seed <= 8; seed++) {
    for (let s = 0; s < PICK_SLOTS.length; s++) {
      const pickSlot = PICK_SLOTS[s]!;
      parts.push(`($${i++}, $${i++}, $${i++}, $${i++}, $${i++})`);
      values.push(orgId, sessionId, seed, pickSlot, s);
    }
  }
  await client.query(
    `INSERT INTO alliance_selection_desk_slots (org_id, session_id, alliance_seed, pick_slot, sort_order)
     VALUES ${parts.join(", ")}
     ON CONFLICT (session_id, alliance_seed, pick_slot) DO NOTHING`,
    values,
  );
}

export async function computeAllianceSelectionDeskView(
  client: PoolClient,
  input: { userId: string; requestedOrg: string | null; sessionId?: string | null },
): Promise<AllianceSelectionDeskView> {
  const org = await resolveOrg(client, input.userId, input.requestedOrg);
  if (!org) {
    return {
      status: "setup_required",
      message: "Select a team workspace to run Alliance Selection Desk.",
      steps: setupSteps(null, null),
      orgId: null,
      eventKey: null,
    };
  }

  if (!org.eventKey) {
    return {
      status: "setup_required",
      message: "Set an active competition event before opening the selection desk.",
      steps: setupSteps(org.orgId, null),
      orgId: org.orgId,
      eventKey: null,
    };
  }

  const [sessions, members] = await Promise.all([
    loadSessions(client, org.orgId, org.eventKey),
    loadMembers(client, org.orgId),
  ]);

  if (sessions.length === 0) {
    return {
      status: "empty",
      message: "No selection desk sessions yet. Create one for this event to start the live pick board.",
      steps: setupSteps(org.orgId, org.eventKey),
      orgId: org.orgId,
      eventKey: org.eventKey,
      eventName: org.eventName,
      teamNumber: org.teamNumber,
      sessions,
      members,
    };
  }

  const activeId = input.sessionId && sessions.some((s) => s.id === input.sessionId)
    ? input.sessionId
    : sessions[0]!.id;

  const sessionResult = await client.query<SessionRow>(
    `SELECT id, name, status, notes, event_key AS "eventKey", updated_at::text AS "updatedAt",
            linked_pick_list_id AS "linkedPickListId"
     FROM alliance_selection_desk_sessions
     WHERE org_id = $1 AND id = $2::uuid`,
    [org.orgId, activeId],
  );
  const session = sessionResult.rows[0];
  if (!session) {
    return {
      status: "empty",
      message: "Session not found.",
      steps: setupSteps(org.orgId, org.eventKey),
      orgId: org.orgId,
      eventKey: org.eventKey,
      eventName: org.eventName,
      teamNumber: org.teamNumber,
      sessions,
      members,
    };
  }

  const [slotResult, evidenceResult, metricResult, scoutCountResult, exportResult] = await Promise.all([
    client.query<SlotRow>(
      `SELECT id, alliance_seed AS "allianceSeed", pick_slot AS "pickSlot", team_key AS "teamKey",
              rationale, sort_order AS "sortOrder"
       FROM alliance_selection_desk_slots
       WHERE org_id = $1 AND session_id = $2::uuid
       ORDER BY alliance_seed, sort_order`,
      [org.orgId, session.id],
    ),
    client.query<EvidenceRow>(
      `SELECT e.id, e.slot_id AS "slotId", e.source_kind AS "sourceKind",
              e.match_scout_entry_id::text AS "matchScoutEntryId",
              e.pit_scout_entry_id::text AS "pitScoutEntryId",
              e.note, e.created_by::text AS "createdBy", u.name AS "createdByName",
              e.created_at::text AS "createdAt"
       FROM alliance_selection_desk_evidence e
       LEFT JOIN users u ON u.id = e.created_by
       WHERE e.org_id = $1 AND e.session_id = $2::uuid
       ORDER BY e.created_at DESC`,
      [org.orgId, session.id],
    ),
    client.query<MetricRow>(
      `SELECT DISTINCT ON (team_key) team_key AS "teamKey", rank, epa_total AS "epaTotal"
       FROM team_event_metrics
       WHERE event_key = $1
       ORDER BY team_key, CASE source WHEN 'tba' THEN 0 WHEN 'statbotics' THEN 1 ELSE 2 END, synced_at DESC`,
      [org.eventKey],
    ),
    client.query<ScoutCountRow>(
      `SELECT team_key AS "teamKey",
              (SELECT COUNT(*)::text FROM match_scout_entries m
               WHERE m.org_id = $1 AND m.event_key = $2 AND m.team_key = t.team_key) AS "matchCount",
              (SELECT COUNT(*)::text FROM pit_scout_entries p
               WHERE p.org_id = $1 AND p.event_key = $2 AND p.team_key = t.team_key) AS "pitCount"
       FROM (
         SELECT DISTINCT team_key FROM alliance_selection_desk_slots
         WHERE org_id = $1 AND session_id = $3::uuid AND team_key IS NOT NULL
       ) t`,
      [org.orgId, org.eventKey, session.id],
    ),
    client.query<{ id: string; createdAt: string; createdByName: string | null }>(
      `SELECT x.id, x.created_at::text AS "createdAt", u.name AS "createdByName"
       FROM alliance_selection_desk_exports x
       LEFT JOIN users u ON u.id = x.created_by
       WHERE x.org_id = $1 AND x.session_id = $2::uuid
       ORDER BY x.created_at DESC
       LIMIT 5`,
      [org.orgId, session.id],
    ),
  ]);

  const metricsByTeam = new Map(metricResult.rows.map((row) => [row.teamKey, row]));
  const scoutByTeam = new Map(
    scoutCountResult.rows.map((row) => [
      row.teamKey,
      { match: Number(row.matchCount) || 0, pit: Number(row.pitCount) || 0 },
    ]),
  );
  const evidenceBySlot = new Map<string, DeskEvidence[]>();
  for (const row of evidenceResult.rows) {
    const list = evidenceBySlot.get(row.slotId) ?? [];
    list.push({
      id: row.id,
      slotId: row.slotId,
      sourceKind: row.sourceKind,
      matchScoutEntryId: row.matchScoutEntryId,
      pitScoutEntryId: row.pitScoutEntryId,
      note: row.note,
      createdBy: row.createdBy,
      createdByName: row.createdByName,
      createdAt: row.createdAt,
    });
    evidenceBySlot.set(row.slotId, list);
  }

  // THE overlay: the spine (pick_list_entries.drafted_*) decides who is in each slot. The desk's
  // own slot rows are kept in sync as a mirror for one release, but they no longer win.
  const spineBoard = await boardState(client, {
    orgId: org.orgId,
    pickListId: session.linkedPickListId,
    eventKey: session.linkedPickListId ? null : org.eventKey,
  });
  const spineBySlot = new Map<string, BoardSlot>();
  for (const slot of spineBoard?.slots ?? []) {
    spineBySlot.set(`${slot.allianceSeed}:${slot.pickSlot}`, slot);
  }

  const slots: DeskSlot[] = slotResult.rows.map((row) => {
    const spine = spineBySlot.get(`${row.allianceSeed}:${row.pickSlot}`) ?? null;
    const teamKey = spineBoard ? spine?.teamKey ?? null : row.teamKey;
    const metrics = teamKey ? metricsByTeam.get(teamKey) : undefined;
    const scout = teamKey ? scoutByTeam.get(teamKey) : undefined;
    return {
      id: row.id,
      allianceSeed: row.allianceSeed,
      pickSlot: row.pickSlot,
      teamKey,
      teamNumber: teamNumberFromKey(teamKey),
      nickname: spine?.nickname ?? null,
      rationale: (spine?.rationale ?? "").trim() || row.rationale,
      sortOrder: row.sortOrder,
      pickListRank: spine?.rank ?? null,
      pickListBucket: spine?.bucket ?? null,
      justification: spine?.justification ?? null,
      evidence: evidenceBySlot.get(row.id) ?? [],
      matchScoutCount: scout?.match ?? 0,
      pitScoutCount: scout?.pit ?? 0,
      tbaRank: metrics?.rank ?? null,
      tbaEpa: metrics?.epaTotal ?? null,
      conflicts: [],
    };
  });

  // Resolve nicknames from teams_ref when available
  const teamKeys = slots.map((s) => s.teamKey).filter((k): k is string => Boolean(k));
  if (teamKeys.length > 0) {
    const nickResult = await client.query<{ teamKey: string; nickname: string | null }>(
      `SELECT team_key AS "teamKey", nickname FROM teams_ref WHERE team_key = ANY($1::text[])`,
      [teamKeys],
    );
    const nickByKey = new Map(nickResult.rows.map((r) => [r.teamKey, r.nickname]));
    for (const slot of slots) {
      if (slot.teamKey) slot.nickname = nickByKey.get(slot.teamKey) ?? null;
    }
  }

  const conflictFlags = detectDeskConflicts({
    slots,
    eventHasTbaMetrics: metricResult.rows.length > 0,
  });
  for (const flag of conflictFlags) {
    const slot = slots.find(
      (s) =>
        s.teamKey === flag.teamKey &&
        s.allianceSeed === flag.allianceSeed &&
        s.pickSlot === flag.pickSlot,
    );
    if (slot) slot.conflicts.push(flag);
  }

  const alliances = groupSlotsByAlliance(slots);
  const canEdit = Boolean(org.role);

  return {
    status: "live",
    orgId: org.orgId,
    eventKey: org.eventKey,
    eventName: org.eventName,
    teamNumber: org.teamNumber,
    canEdit,
    session: {
      id: session.id,
      name: session.name,
      status: session.status,
      notes: session.notes,
      updatedAt: session.updatedAt,
    },
    sessions,
    alliances,
    conflictCount: conflictFlags.length,
    members,
    recentExports: exportResult.rows,
    computedAt: new Date().toISOString(),
  };
}

// ---- writes ----

export async function createDeskSession(
  client: PoolClient,
  input: { orgId: string; userId: string; eventKey: string; name: string; notes?: string | null },
): Promise<string> {
  // A new session drafts from the ONE pick list for this event — find-or-create it now so the
  // board and the collaborative list are the same object from the first pick.
  const pickListId = await ensurePickList(client, {
    orgId: input.orgId,
    userId: input.userId,
    eventKey: input.eventKey,
    name: input.name,
    source: "alliance_desk",
  });

  const inserted = await client.query<{ id: string }>(
    `INSERT INTO alliance_selection_desk_sessions
       (org_id, event_key, name, notes, created_by, linked_pick_list_id)
     VALUES ($1, $2, $3, $4, $5, $6::uuid)
     RETURNING id`,
    [input.orgId, input.eventKey, input.name, input.notes ?? "", input.userId, pickListId],
  );
  const id = inserted.rows[0]!.id;
  await seedDefaultSlots(client, input.orgId, id);
  return id;
}

export async function updateDeskSession(
  client: PoolClient,
  input: {
    orgId: string;
    sessionId: string;
    name?: string | null;
    notes?: string | null;
    status?: DeskSessionStatus | null;
  },
): Promise<void> {
  await client.query(
    `UPDATE alliance_selection_desk_sessions
     SET name = COALESCE($3, name),
         notes = COALESCE($4, notes),
         status = COALESCE($5, status),
         updated_at = now()
     WHERE org_id = $1 AND id = $2::uuid`,
    [input.orgId, input.sessionId, input.name ?? null, input.notes ?? null, input.status ?? null],
  );
}

export async function setDeskSlotTeam(
  client: PoolClient,
  input: {
    orgId: string;
    userId: string;
    sessionId: string;
    slotId: string;
    teamKey: string | null;
    rationale?: string | null;
  },
): Promise<void> {
  const sessionRow = await client.query<{
    status: DeskSessionStatus;
    eventKey: string;
    name: string;
    linkedPickListId: string | null;
  }>(
    `SELECT status, event_key AS "eventKey", name, linked_pick_list_id AS "linkedPickListId"
     FROM alliance_selection_desk_sessions WHERE org_id = $1 AND id = $2::uuid`,
    [input.orgId, input.sessionId],
  );
  const session = sessionRow.rows[0];
  if (!session) throw new Error("Session not found");
  if (session.status === "locked") throw new Error("Session is locked");

  const teamKey = normalizeTeamKey(input.teamKey);

  // Which slot is being set — the desk addresses slots by row id, the spine by (seed, slot).
  const slotRow = await client.query<{ allianceSeed: number; pickSlot: DeskPickSlot }>(
    `SELECT alliance_seed AS "allianceSeed", pick_slot AS "pickSlot"
     FROM alliance_selection_desk_slots
     WHERE org_id = $1 AND session_id = $2::uuid AND id = $3::uuid`,
    [input.orgId, input.sessionId, input.slotId],
  );
  const slot = slotRow.rows[0];
  if (!slot) throw new Error("Slot not found");

  // Source of truth: the ONE pick list. This is what makes the draft board, the collaborative
  // list and Pick Clock agree — the drafted team leaves Pick Clock's available pool immediately.
  const pickListId =
    session.linkedPickListId ??
    (await ensurePickList(client, {
      orgId: input.orgId,
      userId: input.userId,
      eventKey: session.eventKey,
      name: session.name,
      source: "alliance_desk",
    }));

  await setBoardSlot(client, {
    orgId: input.orgId,
    userId: input.userId,
    pickListId,
    allianceSeed: slot.allianceSeed,
    pickSlot: slot.pickSlot,
    teamKey,
    rationale: input.rationale ?? null,
  });

  // Mirror onto the desk's own slot row. Kept for one release so evidence attachments and an
  // in-flight rollback keep working; the read path already prefers the spine.
  await client.query(
    `UPDATE alliance_selection_desk_slots
     SET team_key = $4, rationale = COALESCE($5, rationale), updated_by = $6, updated_at = now()
     WHERE org_id = $1 AND session_id = $2::uuid AND id = $3::uuid`,
    [input.orgId, input.sessionId, input.slotId, teamKey, input.rationale ?? null, input.userId],
  );
  await client.query(
    `UPDATE alliance_selection_desk_sessions
     SET updated_at = now(), linked_pick_list_id = $3::uuid
     WHERE org_id = $1 AND id = $2::uuid`,
    [input.orgId, input.sessionId, pickListId],
  );
}

export async function attachDeskEvidence(
  client: PoolClient,
  input: {
    orgId: string;
    userId: string;
    sessionId: string;
    slotId: string;
    sourceKind: DeskEvidenceKind;
    matchScoutEntryId?: string | null;
    pitScoutEntryId?: string | null;
    note?: string | null;
  },
): Promise<void> {
  if (input.sourceKind === "match_scout") {
    if (!input.matchScoutEntryId) throw new Error("matchScoutEntryId required");
    const ok = await client.query(
      `SELECT 1 FROM match_scout_entries WHERE org_id = $1 AND id = $2::uuid`,
      [input.orgId, input.matchScoutEntryId],
    );
    if (!ok.rowCount) throw new Error("Match scout entry not found");
  }
  if (input.sourceKind === "pit_scout") {
    if (!input.pitScoutEntryId) throw new Error("pitScoutEntryId required");
    const ok = await client.query(
      `SELECT 1 FROM pit_scout_entries WHERE org_id = $1 AND id = $2::uuid`,
      [input.orgId, input.pitScoutEntryId],
    );
    if (!ok.rowCount) throw new Error("Pit scout entry not found");
  }
  if (input.sourceKind === "note" && !(input.note ?? "").trim()) {
    throw new Error("note required");
  }

  await client.query(
    `INSERT INTO alliance_selection_desk_evidence (
       org_id, session_id, slot_id, source_kind, match_scout_entry_id, pit_scout_entry_id, note, created_by
     ) VALUES ($1, $2::uuid, $3::uuid, $4, $5::uuid, $6::uuid, $7, $8)`,
    [
      input.orgId,
      input.sessionId,
      input.slotId,
      input.sourceKind,
      input.sourceKind === "match_scout" ? input.matchScoutEntryId : null,
      input.sourceKind === "pit_scout" ? input.pitScoutEntryId : null,
      (input.note ?? "").trim(),
      input.userId,
    ],
  );
}

export async function removeDeskEvidence(
  client: PoolClient,
  input: { orgId: string; evidenceId: string },
): Promise<void> {
  await client.query(
    `DELETE FROM alliance_selection_desk_evidence WHERE org_id = $1 AND id = $2::uuid`,
    [input.orgId, input.evidenceId],
  );
}

export async function createDeskExport(
  client: PoolClient,
  input: { orgId: string; userId: string; sessionId: string },
): Promise<DeskExportSnapshot> {
  const view = await computeAllianceSelectionDeskView(client, {
    userId: input.userId,
    requestedOrg: input.orgId,
    sessionId: input.sessionId,
  });
  if (view.status !== "live") throw new Error("Session not ready to export");

  const snapshot: DeskExportSnapshot = {
    sessionId: view.session.id,
    sessionName: view.session.name,
    eventKey: view.eventKey,
    eventName: view.eventName,
    status: view.session.status,
    alliances: view.alliances.map((a) => ({
      seed: a.seed,
      picks: a.slots
        .filter((s) => s.teamKey)
        .map((s) => ({
          pickSlot: s.pickSlot,
          teamKey: s.teamKey,
          teamNumber: s.teamNumber,
          nickname: s.nickname,
          rationale: s.rationale,
          evidenceNotes: s.evidence.map((e) => e.note).filter(Boolean),
          conflicts: s.conflicts.map((c) => c.message),
        })),
    })),
    conflictCount: view.conflictCount,
    exportedAt: new Date().toISOString(),
  };

  await client.query(
    `INSERT INTO alliance_selection_desk_exports (org_id, session_id, snapshot, created_by)
     VALUES ($1, $2::uuid, $3::jsonb, $4)`,
    [input.orgId, input.sessionId, JSON.stringify(snapshot), input.userId],
  );

  return snapshot;
}
