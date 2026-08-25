import { randomUUID } from "node:crypto";
import type { PoolClient } from "@neondatabase/serverless";
import { auth } from "@vantage/core";
import {
  onshapeSetupStatus,
  parseOnshapeDocumentUrl,
  readOnshapeApiKeys,
  resolveOnshapeBind,
} from "@vantage/cad";
import { isCadAgentMode } from "@vantage/cad";
import { withRls } from "@vantage/db";
import { headers } from "next/headers";
import {
  loadCadAgentModeState,
  resolveCadAgentModeProposal,
  setCadAgentMode,
} from "../../../../lib/cad/agent-mode-session";
import {
  cadAgentOpenUrl,
  loadCadAgentSession,
  saveCadAgentSession,
  type CadAgentSessionRow,
} from "../../../../lib/cad/cad-agent-session";
import { loadCadAgentOnshape } from "../../../../lib/cad/onshape-tokens";
import { runCadAgentTurn, type CadPlanResponseInput } from "../../../../lib/cad/run-cad-agent";
import { failMeteredAi } from "../../../../lib/metered-ai-fail";

export const dynamic = "force-dynamic";

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

/**
 * Mirrors what loadCadAgentOnshape() will actually accept, so the route can answer
 * setup_required instead of burning a metered AI call on a dead tool layer.
 */
async function onshapeAvailability(client: PoolClient, orgId: string, userId: string) {
  const setup = onshapeSetupStatus();
  const apiKeys = Boolean(readOnshapeApiKeys());
  const connection = await client.query(
    `SELECT 1 FROM cad_connections
      WHERE org_id=$1::uuid AND user_id=$2::uuid AND platform='onshape'
        AND status='connected' AND disabled_at IS NULL
      LIMIT 1`,
    [orgId, userId],
  );
  const oauthReady = Boolean(connection.rowCount) && setup.configured;
  return {
    configured: setup.configured || apiKeys,
    connected: oauthReady || apiKeys,
  };
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

const NOT_CONNECTED =
  "Connect Onshape in CAD Connections (or set ONSHAPE_ACCESS_KEY and ONSHAPE_SECRET_KEY on this server) before the CAD agent can drive a Part Studio.";

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
        bound,
        // Onshape has no embed URL we can mint server-side; the client falls back to
        // openUrl in the frame and offers "Open in Onshape" when Onshape blocks framing.
        iframeUrl: null as string | null,
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
          return { saved } as const;
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
          },
          url: bound.url,
        });
        return { saved } as const;
      });
      if ("setup" in result && typeof result.setup === "string") {
        return setupRequired(result.setup);
      }
      const bound = boundFrom(result.saved);
      return Response.json({ bound, iframeUrl: null, openUrl: bound?.url ?? null });
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

    throw new Error("Unsupported CAD agent action");
  } catch (error) {
    return fail(error);
  }
}
