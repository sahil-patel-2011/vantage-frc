import { auth } from "@vantage/core";
import { withRls } from "@vantage/db";
import { headers } from "next/headers";
import { failMeteredAi } from "../../../lib/metered-ai-fail";
import {
  closeSession,
  computeSessionView,
  computeTroubleshootView,
  saveWalk,
  setupRequired,
  startSession,
  triageWithAi,
  type TroubleshootSessionView,
  type TroubleshootView,
} from "../../../lib/troubleshoot/compute-troubleshoot";
import {
  matchSymptoms,
  symptomById,
  walkSymptom,
  type TroubleshootAnswer,
} from "../../../lib/troubleshoot/symptom-tree";

export type { TroubleshootSessionView, TroubleshootView };

const MAX_ANSWERS = 24;

function trimmedOrNull(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, max) : null;
}

function parseAnswers(value: unknown): TroubleshootAnswer[] {
  if (!Array.isArray(value)) return [];
  const out: TroubleshootAnswer[] = [];
  for (const entry of value.slice(0, MAX_ANSWERS)) {
    if (!entry || typeof entry !== "object") continue;
    const record = entry as Record<string, unknown>;
    const checkId = trimmedOrNull(record.checkId, 80);
    const outcomeId = trimmedOrNull(record.outcomeId, 80);
    if (checkId && outcomeId) out.push({ checkId, outcomeId });
  }
  return out;
}

export async function GET(request: Request) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const requestedOrg = new URL(request.url).searchParams.get("orgId");

  try {
    const view = await withRls({ userId: session.user.id }, (client) =>
      computeTroubleshootView(client, { userId: session.user.id, requestedOrg }),
    );
    return Response.json(view);
  } catch {
    // Product routes degrade to a setup state rather than crashing without a DB.
    return Response.json(setupRequired(requestedOrg), { status: 200 });
  }
}

export async function POST(request: Request) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return Response.json({ error: "Unauthorized" }, { status: 401 });

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

  try {
    const view = await withRls({ userId, orgId }, async (client) => {
      const member = await client.query(
        `SELECT 1 FROM memberships WHERE org_id = $1::uuid AND user_id = $2::uuid`,
        [orgId, userId],
      );
      if (!member.rowCount) throw new Error("forbidden");

      switch (action) {
        // Free text in, an entry node out. AI is optional: without an adapter the
        // curated offline matcher answers and the walk is byte-for-byte the same.
        case "triage": {
          const described = trimmedOrNull(body.text, 2000);
          if (!described) throw new Error("Describe what is happening first");

          const offline = matchSymptoms(described, 3);
          const useAi = body.useAi !== false;

          let aiSuggestion = null;
          let aiNote: string | null = null;
          let aiProvenance = null;
          if (useAi) {
            const triaged = await triageWithAi(client, { orgId, userId, description: described });
            aiSuggestion = triaged.suggestion;
            aiNote = triaged.note;
            aiProvenance = triaged.provenance;
          }

          const symptomId = aiSuggestion?.symptomId ?? offline[0]?.symptomId ?? null;
          if (!symptomId) {
            throw new Error(
              "Nothing in the guide matches that yet — pick the closest symptom from the list instead.",
            );
          }

          const sessionId = await startSession(client, { orgId, userId, symptomId, described });
          return computeSessionView(client, {
            orgId,
            userId,
            symptomId,
            sessionId,
            answers: [],
            aiSuggestion,
            aiNote,
            aiProvenance,
            alternatives: offline.map((hit) => ({ symptomId: hit.symptomId, label: hit.label })),
          });
        }

        // Symptom picked straight from the list — no AI involved at all.
        case "start": {
          const symptomId = trimmedOrNull(body.symptomId, 80);
          if (!symptomId || !symptomById(symptomId)) throw new Error("Unknown symptom");
          const described = trimmedOrNull(body.text, 2000);
          const sessionId = await startSession(client, { orgId, userId, symptomId, described });
          return computeSessionView(client, { orgId, userId, symptomId, sessionId, answers: [] });
        }

        case "answer": {
          const symptomId = trimmedOrNull(body.symptomId, 80);
          if (!symptomId || !symptomById(symptomId)) throw new Error("Unknown symptom");
          const answers = parseAnswers(body.answers);
          const walk = walkSymptom(symptomId, answers);
          if (!walk || walk.invalid) throw new Error("That step is out of date — restart the walk");

          const sessionId = trimmedOrNull(body.sessionId, 64);
          if (sessionId) await saveWalk(client, { orgId, userId, sessionId, walk });

          return computeSessionView(client, { orgId, userId, symptomId, sessionId, answers });
        }

        case "close": {
          const symptomId = trimmedOrNull(body.symptomId, 80);
          if (!symptomId || !symptomById(symptomId)) throw new Error("Unknown symptom");
          const sessionId = trimmedOrNull(body.sessionId, 64);
          const resolved = body.resolved === true;
          const resolution = trimmedOrNull(body.resolution, 4000);
          if (sessionId) {
            await closeSession(client, { orgId, userId, sessionId, resolved, resolution });
          }
          return computeSessionView(client, {
            orgId,
            userId,
            symptomId,
            sessionId,
            answers: parseAnswers(body.answers),
          });
        }

        default:
          throw new Error("Unknown action");
      }
    });

    if (!view) return Response.json({ error: "Unknown symptom" }, { status: 400 });
    return Response.json(view);
  } catch (error) {
    return failMeteredAi(error, "Get-unstuck request failed");
  }
}
