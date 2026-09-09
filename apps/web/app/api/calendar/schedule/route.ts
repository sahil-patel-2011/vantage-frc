import { randomUUID } from "node:crypto";
import { getOrgPromptCachingEnabled, resolveOrgChatAdapter } from "@vantage/agent";
import { meteredAI } from "@vantage/billing";
import { auth } from "@vantage/core";
import { withRls } from "@vantage/db";
import { headers } from "next/headers";
import { createBridgeTransport } from "../../../../lib/ai-bridge/transport";
import { failMeteredAi } from "../../../../lib/metered-ai-fail";
import { SUBTEAM_EVENT_KINDS } from "../../../../lib/subteam-calendar";
import {
  proposeSlots,
  slotEvidence,
  WEEKDAY_NAMES,
  type BusyWindow,
  type PastAttendance,
  type PastEvent,
  type Weekday,
} from "../../../../lib/calendar-ai/availability";

/**
 * AI scheduling for the team calendar.
 *
 * The split that makes this trustworthy: the MODEL never picks a time. It reads
 * the request and returns intent — what kind of session, how long, which
 * subteam, and any weekday/hour the person explicitly asked for. Every actual
 * date comes from `proposeSlots`, computed from this team's own past events,
 * RSVPs and attendance, and checked against the real calendar for conflicts.
 *
 * So the model cannot hallucinate "most people are free Thursday". If the team
 * has no attendance history, there is no evidence, `proposeSlots` returns
 * nothing, and we say that plainly instead of inventing three confident times.
 *
 * Nothing is written here. This proposes; the person confirms in the UI and the
 * existing calendar route creates the event. An AI that silently puts things on
 * a team's calendar is a worse product than one that suggests.
 */

class HttpError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

function fail(error: unknown) {
  if (error instanceof HttpError) return Response.json({ error: error.message }, { status: error.status });
  return failMeteredAi(error, "Could not work out a time right now.");
}

const INTENT_SCHEMA_HINT = `Reply with ONLY a JSON object, no prose, no code fence:
{
  "title": "short event title",
  "kind": "practice|build|deadline|event|meeting|outreach|other",
  "durationMinutes": 60,
  "subteam": "mechanical|electrical|programming|cad|scouting|business|pit|drive|null",
  "preferredWeekday": 0-6 or null,
  "preferredHour": 0-23 or null,
  "horizonDays": 14
}`;

type Intent = {
  title?: string;
  kind?: string;
  durationMinutes?: number;
  subteam?: string | null;
  preferredWeekday?: number | null;
  preferredHour?: number | null;
  horizonDays?: number;
};

// The same list the calendar form and `create_event` validate against. Imported
// rather than repeated so a new kind can never be proposed here and then
// rejected by the create call the person clicks straight afterwards.
const KINDS: readonly string[] = SUBTEAM_EVENT_KINDS;

function parseIntent(raw: string): Intent {
  // The model is asked for bare JSON, but a fenced block is the usual failure
  // and is trivially recoverable — better than rejecting the whole request.
  const cleaned = raw.trim().replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start === -1 || end === -1) return {};
  try {
    return JSON.parse(cleaned.slice(start, end + 1)) as Intent;
  } catch {
    return {};
  }
}

function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.round(n)));
}

export async function POST(request: Request) {
  try {
    const session = await auth.api.getSession({ headers: await headers() });
    if (!session) throw new HttpError(401, "Authentication required");

    const body = (await request.json()) as { request?: string };
    const ask = (body.request ?? "").trim().slice(0, 600);
    if (!ask) throw new HttpError(400, "Say what you want to schedule");

    const now = new Date();

    const result = await withRls({ userId: session.user.id }, async (client) => {
      const membership = await client.query<{ orgId: string; orgName: string; role: string }>(
        `SELECT m.org_id AS "orgId", o.name AS "orgName", m.role
           FROM memberships m JOIN organizations o ON o.id = m.org_id
          WHERE m.user_id = $1::uuid ORDER BY o.name LIMIT 1`,
        [session.user.id],
      );
      const org = membership.rows[0];
      if (!org) throw new HttpError(403, "Organization membership required");
      if (org.role !== "owner" && org.role !== "admin") {
        throw new HttpError(403, "Only owners and admins can schedule team events");
      }

      // --- the model reads the request, and only the request -------------
      const promptCachingEnabled = await getOrgPromptCachingEnabled(client, org.orgId);
      const adapter = await resolveOrgChatAdapter(client, {
        orgId: org.orgId,
        userId: session.user.id,
        promptCachingEnabled,
        feature: "calendar_schedule",
        bridgeTransport: createBridgeTransport(),
      });

      const intentPrompt = [
        "You turn a scheduling request from an FRC robotics team into structured intent.",
        "You do NOT choose a date or time. Another system does that from the team's real attendance history.",
        "Only set preferredWeekday/preferredHour if the person explicitly named a day or time.",
        `Today is ${WEEKDAY_NAMES[now.getDay() as Weekday]}, ${now.toISOString().slice(0, 10)}.`,
        "",
        INTENT_SCHEMA_HINT,
        "",
        `REQUEST: ${ask}`,
      ].join("\n");

      const raw = await meteredAI({
        client,
        orgId: org.orgId,
        userId: session.user.id,
        feature: "calendar_schedule",
        requestId: randomUUID(),
        estimatedCostUsd: 0.002,
        estimatedPromptTokens: Math.ceil(intentPrompt.length / 4),
        estimatedCompletionTokens: 120,
        provider: adapter.provider,
        model: adapter.model,
        metadata: { action: "calendar_schedule" },
        invoke: async () => {
          const completion = await adapter.complete({
            message: intentPrompt,
            context: [],
            promptCachingEnabled,
          });
          return {
            value: completion.text,
            promptTokens: completion.promptTokens,
            completionTokens: completion.completionTokens,
            costUsd: completion.costUsd,
            model: adapter.model,
            provider: adapter.provider,
            cacheReadInputTokens: completion.cacheReadInputTokens,
            cacheWriteInputTokens: completion.cacheWriteInputTokens,
            uncachedInputTokens: completion.uncachedInputTokens,
          };
        },
      });

      const intent = parseIntent(raw);
      const durationMinutes = clampInt(intent.durationMinutes, 15, 8 * 60, 120);
      const horizonDays = clampInt(intent.horizonDays, 1, 90, 21);
      const kind = KINDS.includes(String(intent.kind)) ? String(intent.kind) : "meeting";
      const title = (intent.title ?? "").trim().slice(0, 200) || "Team session";

      // --- the facts come from the team's own rows ------------------------
      const subteam = await client.query<{ id: string }>(
        `SELECT id FROM team_subteams
          WHERE org_id = $1::uuid AND $2::text IS NOT NULL AND lower(name) LIKE '%' || lower($2::text) || '%'
          LIMIT 1`,
        [org.orgId, intent.subteam ?? null],
      );
      const subteamId = subteam.rows[0]?.id ?? null;

      const past = await client.query<PastEvent>(
        `SELECT e.starts_at::text AS "startsAt",
                e.ends_at::text   AS "endsAt",
                e.kind,
                e.subteam_id::text AS "subteamId",
                (SELECT count(*)::int FROM subteam_calendar_rsvps r
                  WHERE r.event_id = e.id AND r.response = 'going') AS going,
                (SELECT count(*)::int FROM memberships m WHERE m.org_id = e.org_id) AS invited
           FROM subteam_calendar_events e
          WHERE e.org_id = $1::uuid
            AND e.starts_at < now()
            AND e.starts_at > now() - interval '120 days'
          ORDER BY e.starts_at DESC
          LIMIT 200`,
        [org.orgId],
      );

      const attendance = await client.query<PastAttendance>(
        `SELECT a.occurred_on::text AS "occurredOn",
                a.kind,
                (SELECT count(*)::int FROM attendance_entries n WHERE n.event_id = a.id) AS attended
           FROM attendance_events a
          WHERE a.org_id = $1::uuid
            AND a.occurred_on > (now() - interval '120 days')::date
          ORDER BY a.occurred_on DESC
          LIMIT 200`,
        [org.orgId],
      );

      const busyRows = await client.query<BusyWindow>(
        `SELECT starts_at::text AS "startsAt", ends_at::text AS "endsAt", title
           FROM subteam_calendar_events
          WHERE org_id = $1::uuid AND starts_at >= now()
          ORDER BY starts_at LIMIT 400`,
        [org.orgId],
      );

      const evidence = slotEvidence({
        events: past.rows,
        attendance: attendance.rows,
        subteamId,
      });

      const preferredWeekday =
        intent.preferredWeekday == null ? undefined : (clampInt(intent.preferredWeekday, 0, 6, 0) as Weekday);
      const preferredHour = intent.preferredHour == null ? undefined : clampInt(intent.preferredHour, 0, 23, 18);

      const proposals = proposeSlots({
        now,
        evidence,
        busy: busyRows.rows,
        durationMinutes,
        horizonDays,
        limit: 3,
        ...(preferredWeekday != null || preferredHour != null
          ? { preferred: { weekday: preferredWeekday, hour: preferredHour } }
          : {}),
      });

      // Honest empty state. This is the branch that stops the feature lying.
      const basis =
        evidence.some((s) => s.evidence != null)
          ? "your team's past sessions"
          : past.rowCount || attendance.rowCount
            ? "not enough history yet — a slot needs at least 3 past sessions before we call it a pattern"
            : "no past sessions recorded yet";

      return {
        orgName: org.orgName,
        title,
        kind,
        durationMinutes,
        subteamId,
        basis,
        evidence: evidence.filter((s) => s.evidence != null).slice(0, 5),
        proposals,
        // Everything the person needs to confirm; nothing has been written.
        wroteAnything: false,
      };
    });

    return Response.json(result);
  } catch (error) {
    return fail(error);
  }
}
