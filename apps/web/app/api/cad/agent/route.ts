import { randomUUID } from "node:crypto";
import type { PoolClient } from "@neondatabase/serverless";
import { auth } from "@vantage/core";
import { onshapeSetupStatus, parseOnshapeDocumentUrl, resolveOnshapeBind } from "@vantage/cad";
import { isCadAgentMode } from "@vantage/cad";
import { withRls } from "@vantage/db";
import { headers } from "next/headers";
import {
  approveCadPlanSteps,
  discardCadPlan,
  loadCadAgentModeState,
  resolveCadAgentModeProposal,
  setCadAgentMode,
  type CadPlanDecision,
} from "../../../../lib/cad/agent-mode-session";
import {
  cadAgentOpenUrl,
  loadCadAgentSession,
  saveCadAgentSession,
  type CadAgentSessionRow,
} from "../../../../lib/cad/cad-agent-session";
import { loadCadAgentOnshape, onshapeAvailability } from "../../../../lib/cad/onshape-tokens";
import { executeCadPlanStep, runCadAgentTurn, type CadPlanResponseInput } from "../../../../lib/cad/run-cad-agent";
import { failMeteredAi } from "../../../../lib/metered-ai-fail";

export const dynamic = "force-dynamic";
/** Plan-step execution can wait on an Onshape STEP translation (polls up to ~60 s). */
export const maxDuration = 120;

type BoundDoc = {
  documentId: string;
  workspaceId: string;
  elementId: string;
  documentName: string | null;
  url: string | null;
};

async function current() {
  const value = await auth.api.getSession({ headers: await headers() });
  if (!value) throw new Error("Authentication required");
  return value;
}

const fail = (error: unknown) => failMeteredAi(error, "CAD agent failed");

function setupRequired(message: string) {
  return Response.json(
    { ...onshapeSetupStatus(), error: message, message, code: "setup_required", status: "setup_required" },
    { status: 503 },
  );
}

async function assertMember(client: PoolClient, orgId: string, userId: string) {
  const member = await client.query(`SELECT 1 FROM memberships WHERE org_id=$1::uuid AND user_id=$2::uuid`, [
    orgId,
    userId,
  ]);
  if (!member.rowCount) throw new Error("Organization access denied");
}

function boundFrom(stored: CadAgentSessionRow | null): BoundDoc | null {
  if (!stored?.session.documentId) return null;
  return {
    documentId: stored.session.documentId,
    workspaceId: stored.session.workspaceId ?? "",
    elementId: stored.session.elementId ?? "",
    documentName: stored.session.documentName ?? null,
    url: stored.url || cadAgentOpenUrl(stored.session),
  };
}

/** The shaded-view endpoint for this org's bound Part Studio (see ./view/route.ts). */
function viewUrlFor(orgId: string, bound: BoundDoc | null): string | null {
  return bound ? `/api/cad/agent/view?orgId=${encodeURIComponent(orgId)}` : null;
}

const NOT_CONNECTED =
  "Connect Onshape in CAD Connections (or ask an owner/admin to share a team connection, or set ONSHAPE_ACCESS_KEY and ONSHAPE_SECRET_KEY on this server) before the CAD agent can drive a Part Studio.";

export async function GET(request: Request) {
  try {
    const session = await current();
    const orgId = new URL(request.url).searchParams.get("orgId");
    if (!orgId) throw new Error("orgId is required");
    const state = await withRls({ userId: session.user.id, orgId }, async (client) => {
      await assertMember(client, orgId, session.user.id);
      const [availability, stored, modeState] = await Promise.all([
        onshapeAvailability(client, orgId, session.user.id),
        loadCadAgentSession(client, orgId, session.user.id),
        loadCadAgentModeState(client, orgId, session.user.id),
      ]);
      const bound = boundFrom(stored);
      return {
        onshapeConfigured: availability.configured,
        onshapeConnected: availability.connected,
        onshapeVia: availability.via,
        bound,
        // Onshape refuses to be framed, so the viewport is a server-fetched shaded
        // view PNG (viewUrl) plus a deep link (openUrl). No iframe is ever minted.
        iframeUrl: null as string | null,
        viewUrl: availability.connected ? viewUrlFor(orgId, bound) : null,
        openUrl: bound?.url ?? null,
        messages: stored?.messages ?? [],
        // Narrated build steps for the session pane (see packages/cad/src/cad-agent-steps.ts).
        steps: stored?.steps ?? [],
        modeState,
      };
    });
    return Response.json(state, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return fail(error);
  }
}

function parseDecisions(raw: unknown): CadPlanDecision[] {
  if (!Array.isArray(raw)) return [];
  const decisions: CadPlanDecision[] = [];
  for (const item of raw.slice(0, 40)) {
    if (!item || typeof item !== "object") continue;
    const record = item as Record<string, unknown>;
    const sequence = Number(record.sequence);
    if (!Number.isInteger(sequence) || sequence < 1) continue;
    const args = record.args && typeof record.args === "object" && !Array.isArray(record.args) ? (record.args as Record<string, unknown>) : undefined;
    if (args && JSON.stringify(args).length > 20_000) throw new Error(`Step ${sequence}: arguments exceed the 20,000-character limit.`);
    decisions.push({ sequence, approved: record.approved === true, ...(args ? { args } : {}) });
  }
  return decisions;
}

export async function POST(request: Request) {
  try {
    const session = await current();
    const body = (await request.json()) as {
      action?: string;
      orgId?: string;
      url?: string;
      message?: string;
      mode?: string;
      accept?: boolean;
      planResponse?: CadPlanResponseInput | null;
      planId?: string;
      decisions?: unknown;
      answers?: unknown;
      sequence?: number;
    };
    const orgId = String(body.orgId ?? "");
    const action = String(body.action ?? "");
    if (!orgId) throw new Error("orgId is required");

    if (action === "bind") {
      const url = String(body.url ?? "").trim();
      if (!url) throw new Error("Paste an Onshape document URL to bind");
      const result = await withRls({ userId: session.user.id, orgId }, async (client) => {
        await assertMember(client, orgId, session.user.id);
        const availability = await onshapeAvailability(client, orgId, session.user.id);
        if (!availability.connected) {
          // Without a live Onshape client we can only bind a URL that already names the
          // workspace and Part Studio — nothing is looked up, so nothing is guessed.
          const parsed = parseOnshapeDocumentUrl(url);
          if (!parsed.workspaceId || !parsed.elementId) return { setup: NOT_CONNECTED } as const;
          const saved = await saveCadAgentSession(client, {
            orgId,
            userId: session.user.id,
            connectionId: null,
            session: {
              documentId: parsed.documentId,
              workspaceId: parsed.workspaceId,
              elementId: parsed.elementId,
            },
          });
          return { saved, connected: false } as const;
        }
        const onshape = await loadCadAgentOnshape(client, orgId, session.user.id);
        const bound = await resolveOnshapeBind(url, onshape.http);
        const saved = await saveCadAgentSession(client, {
          orgId,
          userId: session.user.id,
          connectionId: onshape.connectionId,
          session: {
            documentId: bound.documentId,
            workspaceId: bound.workspaceId,
            elementId: bound.elementId,
            documentName: bound.documentName ?? bound.elementName,
            elementName: bound.elementName,
          },
          url: bound.url,
        });
        return { saved, connected: true } as const;
      });
      if ("setup" in result && typeof result.setup === "string") {
        return setupRequired(result.setup);
      }
      const bound = boundFrom(result.saved);
      return Response.json({
        bound,
        iframeUrl: null,
        viewUrl: result.connected ? viewUrlFor(orgId, bound) : null,
        openUrl: bound?.url ?? null,
      });
    }

    if (action === "set-mode") {
      // Manual switch via the segmented control — no consent flow, no Onshape needed.
      if (!isCadAgentMode(body.mode)) throw new Error("Unknown CAD agent mode");
      const mode = body.mode;
      const modeState = await withRls({ userId: session.user.id, orgId }, async (client) => {
        await assertMember(client, orgId, session.user.id);
        return setCadAgentMode(client, { orgId, userId: session.user.id, mode });
      });
      return Response.json({ modeState });
    }

    if (action === "propose-response") {
      // Yes/No (or countdown expiry) on a mode-switch proposal. The 15-second
      // window is enforced server-side: an expired Yes still keeps the old mode.
      const accept = body.accept === true;
      const message = String(body.message ?? "").trim();
      const result = await withRls({ userId: session.user.id, orgId }, async (client) => {
        await assertMember(client, orgId, session.user.id);
        const resolved = await resolveCadAgentModeProposal(client, { orgId, userId: session.user.id, accept });
        if (!message) return { resolved } as const;
        const availability = await onshapeAvailability(client, orgId, session.user.id);
        if (!availability.connected) return { setup: NOT_CONNECTED } as const;
        return {
          resolved,
          turn: await runCadAgentTurn({
            client,
            orgId,
            userId: session.user.id,
            requestId: randomUUID(),
            message,
            allowProposal: false,
          }),
        } as const;
      });
      if ("setup" in result && typeof result.setup === "string") {
        return setupRequired(result.setup);
      }
      if (!("turn" in result) || !result.turn) {
        return Response.json({
          modeState: result.resolved.state,
          applied: result.resolved.applied,
          expired: result.resolved.expired,
        });
      }
      return Response.json({
        text: result.turn.text,
        tools: result.turn.tools,
        steps: result.turn.steps,
        messages: result.turn.messages,
        modeState: result.turn.modeState,
        applied: result.resolved.applied,
        expired: result.resolved.expired,
      });
    }

    if (action === "chat") {
      const message = String(body.message ?? "").trim();
      const planResponse = body.planResponse && body.planResponse.approve === true ? body.planResponse : null;
      if (!message && !planResponse) throw new Error("Write a millimetre brief for the CAD agent");
      const result = await withRls({ userId: session.user.id, orgId }, async (client) => {
        await assertMember(client, orgId, session.user.id);
        const availability = await onshapeAvailability(client, orgId, session.user.id);
        if (!availability.connected) return { setup: NOT_CONNECTED } as const;
        return {
          turn: await runCadAgentTurn({
            client,
            orgId,
            userId: session.user.id,
            requestId: randomUUID(),
            message,
            planResponse,
          }),
        } as const;
      });
      if ("setup" in result && typeof result.setup === "string") {
        return setupRequired(result.setup);
      }
      return Response.json({
        text: result.turn.text,
        tools: result.turn.tools,
        steps: result.turn.steps,
        messages: result.turn.messages,
        modeState: result.turn.modeState,
        proposal: result.turn.proposal,
      });
    }

    if (action === "approve-plan") {
      // Record which proposed tool calls the reviewer accepted (all or a subset,
      // with edited arguments). Nothing runs here — execution is step by step.
      const planId = String(body.planId ?? "").trim();
      if (!planId) throw new Error("planId is required");
      const decisions = parseDecisions(body.decisions);
      if (!decisions.length) throw new Error("Choose at least one step to approve or reject.");
      const answers = Array.isArray(body.answers) ? body.answers.map((answer) => String(answer ?? "")).slice(0, 10) : undefined;
      const modeState = await withRls({ userId: session.user.id, orgId }, async (client) => {
        await assertMember(client, orgId, session.user.id);
        return approveCadPlanSteps(client, { orgId, userId: session.user.id, planId, decisions, answers });
      });
      return Response.json({ modeState });
    }

    if (action === "execute-plan-step") {
      const sequence = Number(body.sequence);
      if (!Number.isInteger(sequence) || sequence < 1) throw new Error("sequence is required");
      const result = await withRls({ userId: session.user.id, orgId }, async (client) => {
        await assertMember(client, orgId, session.user.id);
        const availability = await onshapeAvailability(client, orgId, session.user.id);
        if (!availability.connected) return { setup: NOT_CONNECTED } as const;
        return { run: await executeCadPlanStep({ client, orgId, userId: session.user.id, sequence }) } as const;
      });
      if ("setup" in result && typeof result.setup === "string") {
        return setupRequired(result.setup);
      }
      return Response.json({
        step: result.run.step,
        done: result.run.done,
        steps: result.run.steps,
        messages: result.run.messages,
        modeState: result.run.modeState,
      });
    }

    if (action === "discard-plan") {
      // Unrun steps of the plan are marked cancelled in cad_job_steps; executed rows stay as history.
      const modeState = await withRls({ userId: session.user.id, orgId }, async (client) => {
        await assertMember(client, orgId, session.user.id);
        return discardCadPlan(client, { orgId, userId: session.user.id });
      });
      return Response.json({ modeState });
    }

    throw new Error("Unsupported CAD agent action");
  } catch (error) {
    return fail(error);
  }
}
