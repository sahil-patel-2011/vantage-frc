import { auth } from "@vantage/core";
import { withRls } from "@vantage/db";
import { assertScoutingLead } from "@vantage/scouting/permissions";
import { headers } from "next/headers";
import {
  attachDeskEvidence,
  computeAllianceSelectionDeskView,
  createDeskExport,
  createDeskSession,
  removeDeskEvidence,
  setDeskSlotTeam,
  updateDeskSession,
  type AllianceSelectionDeskView,
} from "../../../lib/alliance-selection-desk";
import type { DeskEvidenceKind, DeskSessionStatus } from "../../../lib/alliance-selection-desk/types";
import { publicErrorMessage } from "../../../lib/security/public-error";

export type { AllianceSelectionDeskView };

const SESSION_STATUSES: DeskSessionStatus[] = ["draft", "live", "locked"];
const EVIDENCE_KINDS: DeskEvidenceKind[] = ["match_scout", "pit_scout", "note"];

function oneOf<T extends string>(allowed: T[], value: unknown): T | null {
  return typeof value === "string" && (allowed as string[]).includes(value) ? (value as T) : null;
}

function trimmedOrNull(value: unknown, max = 2000): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, max) : null;
}

export async function GET(request: Request) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return Response.json({ error: "Your session ended. Sign in again." }, { status: 401 });

  const url = new URL(request.url);
  const requestedOrg = url.searchParams.get("orgId");
  const sessionId = url.searchParams.get("sessionId");

  try {
    const view = await withRls({ userId: session.user.id }, (client) =>
      computeAllianceSelectionDeskView(client, {
        userId: session.user.id,
        requestedOrg,
        sessionId,
      }),
    );
    if (requestedOrg && view.orgId !== requestedOrg) return Response.json({ error: "Team access changed. Choose a team you belong to." }, { status: 403, headers: { "Cache-Control": "private, no-store" } });
    if (sessionId && (view.status !== "live" || view.session.id !== sessionId)) return Response.json({ error: "This board session is no longer available." }, { status: 404, headers: { "Cache-Control": "private, no-store" } });
    return Response.json(view, { headers: { "Cache-Control": "private, no-store" } });
  } catch {
    return Response.json({ error: "Alliance selection is temporarily unavailable. Refresh to try again." }, { status: 503, headers: { "Cache-Control": "private, no-store" } });
  }
}

export async function POST(request: Request) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return Response.json({ error: "Your session ended. Sign in again." }, { status: 401 });

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const orgId = trimmedOrNull(body.orgId, 64);
  const action = typeof body.action === "string" ? body.action : "";
  if (!orgId) return Response.json({ error: "orgId is required" }, { status: 400 });

  const userId = session.user.id;
  let activeSession = trimmedOrNull(body.sessionId, 64);

  try {
    const result = await withRls({ userId, orgId }, async (client) => {
      const member = await client.query(`SELECT 1 FROM memberships WHERE org_id = $1 AND user_id = $2`, [
        orgId,
        userId,
      ]);
      if (!member.rowCount) throw new Error("forbidden");
      if (action !== "export-drive-team") await assertScoutingLead(client, orgId);

      switch (action) {
        case "create-session": {
          const eventKey = trimmedOrNull(body.eventKey, 64);
          const name = trimmedOrNull(body.name, 120) ?? "Alliance Selection";
          if (!eventKey) throw new Error("eventKey is required");
          activeSession = await createDeskSession(client, {
            orgId,
            userId,
            eventKey,
            name,
            notes: trimmedOrNull(body.notes, 4000),
          });
          break;
        }
        case "update-session": {
          if (!activeSession) throw new Error("sessionId is required");
          await updateDeskSession(client, {
            orgId,
            sessionId: activeSession,
            name: trimmedOrNull(body.name, 120),
            notes: trimmedOrNull(body.notes, 4000),
            status: oneOf(SESSION_STATUSES, body.status),
          });
          break;
        }
        case "set-slot": {
          if (!activeSession) throw new Error("sessionId is required");
          const slotId = trimmedOrNull(body.slotId, 64);
          if (!slotId) throw new Error("slotId is required");
          const teamRaw = typeof body.teamKey === "string" ? body.teamKey : body.teamNumber != null ? String(body.teamNumber) : null;
          await setDeskSlotTeam(client, {
            orgId,
            userId,
            sessionId: activeSession,
            slotId,
            teamKey: teamRaw,
            rationale: trimmedOrNull(body.rationale, 2000),
          });
          break;
        }
        case "attach-evidence": {
          if (!activeSession) throw new Error("sessionId is required");
          const slotId = trimmedOrNull(body.slotId, 64);
          const sourceKind = oneOf(EVIDENCE_KINDS, body.sourceKind);
          if (!slotId || !sourceKind) throw new Error("slotId and sourceKind are required");
          await attachDeskEvidence(client, {
            orgId,
            userId,
            sessionId: activeSession,
            slotId,
            sourceKind,
            matchScoutEntryId: trimmedOrNull(body.matchScoutEntryId, 64),
            pitScoutEntryId: trimmedOrNull(body.pitScoutEntryId, 64),
            note: trimmedOrNull(body.note, 4000),
          });
          break;
        }
        case "remove-evidence": {
          const evidenceId = trimmedOrNull(body.evidenceId, 64);
          if (!evidenceId) throw new Error("evidenceId is required");
          await removeDeskEvidence(client, { orgId, evidenceId });
          break;
        }
        case "export-drive-team": {
          if (!activeSession) throw new Error("sessionId is required");
          const snapshot = await createDeskExport(client, {
            orgId,
            userId,
            sessionId: activeSession,
          });
          const view = await computeAllianceSelectionDeskView(client, {
            userId,
            requestedOrg: orgId,
            sessionId: activeSession,
          });
          return { view, snapshot };
        }
        default:
          throw new Error(`Unknown action: ${action || "(empty)"}`);
      }

      const view = await computeAllianceSelectionDeskView(client, {
        userId,
        requestedOrg: orgId,
        sessionId: activeSession,
      });
      if (view.status !== "live" || view.orgId !== orgId || (activeSession && view.session.id !== activeSession)) {
        throw Object.assign(new Error("Could not confirm the saved board. Refresh before retrying."), { status: 503 });
      }
      return { view };
    });

    return Response.json(result, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    if (error && typeof error === "object" && "status" in error && error.status === 403) {
      return Response.json({ error: "Scouting lead access required." }, { status: 403, headers: { "Cache-Control": "private, no-store" } });
    }
    if (error && typeof error === "object" && "status" in error && error.status === 503) {
      return Response.json({ error: "Could not confirm the saved board. Refresh before retrying." }, { status: 503, headers: { "Cache-Control": "private, no-store" } });
    }
    const message = publicErrorMessage(error, "Request failed");
    if (message === "forbidden") return Response.json({ error: "Forbidden" }, { status: 403 });
    return Response.json({ error: message }, { status: 400 });
  }
}
