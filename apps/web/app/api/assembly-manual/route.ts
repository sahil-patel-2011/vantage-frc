import { randomUUID } from "node:crypto";
import { getOrgPromptCachingEnabled, resolveOrgChatAdapter } from "@vantage/agent";
import { meteredAI } from "@vantage/billing";
import { isOnshapeOAuthConfigured, parseOnshapeDocumentUrl, type OnshapeHttp } from "@vantage/cad";
import { auth } from "@vantage/core";
import { withRls } from "@vantage/db";
import { headers } from "next/headers";
import { createBridgeTransport } from "../../../lib/ai-bridge/transport";
import { loadCadAgentOnshape } from "../../../lib/cad/onshape-tokens";
import { listAssemblyElements } from "../../../lib/assembly-manual/ingest";
import {
  HttpError,
  failResponse,
  lastWorkerCheckIn,
  listOnshapeVaultDocuments,
  listRuns,
  requireLead,
  resolveMembership,
  startRun,
} from "../../../lib/assembly-manual/store";
import { deterministicSentence, sentenceIsGrounded, type StepWriteFacts } from "../../../lib/assembly-manual/write";

export const runtime = "nodejs";

/**
 * Start, list, and (for one step at a time) re-word an assembly manual.
 *
 * Nothing here builds anything. Starting a run inserts a queued row and
 * returns; the work happens on the relay, because a full robot is hours of
 * Onshape calls and no request handler should hold that. The one thing this
 * route does spend a model on is re-wording a single step at a member's
 * request, and that goes through `meteredAI` like every other request-path
 * model call in this codebase.
 */

async function onshapeFor(
  client: Parameters<typeof loadCadAgentOnshape>[0],
  orgId: string,
  userId: string,
): Promise<{ ok: true; http: OnshapeHttp } | { ok: false; message: string }> {
  try {
    const connection = await loadCadAgentOnshape(client, orgId, userId);
    return { ok: true, http: connection.http };
  } catch (error) {
    return {
      ok: false,
      message:
        error instanceof Error && error.message
          ? error.message
          : "Connect Onshape before building an assembly manual.",
    };
  }
}

export async function GET() {
  try {
    const session = await auth.api.getSession({ headers: await headers() });
    if (!session) throw new HttpError(401, "Authentication required");

    const payload = await withRls({ userId: session.user.id }, async (client) => {
      const membership = await resolveMembership(client, session.user.id);
      const [runs, vault, workerSeen] = await Promise.all([
        listRuns(client, membership.orgId),
        listOnshapeVaultDocuments(client, membership.orgId),
        lastWorkerCheckIn(client, membership.orgId),
      ]);

      const onshape = await onshapeFor(client, membership.orgId, session.user.id);
      return {
        orgName: membership.orgName,
        canStart: membership.role === "owner" || membership.role === "admin",
        onshape: {
          connected: onshape.ok,
          configured: isOnshapeOAuthConfigured(),
          message: onshape.ok ? "" : onshape.message,
        },
        // Real lease activity, not a claim that a relay is up.
        worker: {
          lastCheckIn: workerSeen,
          message: workerSeen
            ? `A worker last picked up one of your runs at ${workerSeen}.`
            : "No worker has picked up a run for your team yet. This job runs on your team's relay — start it, or ask whoever runs the relay to bring it up.",
        },
        vault,
        runs,
      };
    });

    return Response.json(payload);
  } catch (error) {
    return failResponse(error, "Could not load assembly manual runs.");
  }
}

type StartBody = {
  action?: "start";
  url?: string;
  documentId?: string;
  elementId?: string;
};

type RewriteBody = {
  action: "rewrite-step";
  runId?: string;
  stepNumber?: number;
};

export async function POST(request: Request) {
  try {
    const session = await auth.api.getSession({ headers: await headers() });
    if (!session) throw new HttpError(401, "Authentication required");
    const body = (await request.json()) as StartBody | RewriteBody;

    if (body.action === "rewrite-step") return rewriteStep(session.user.id, body);
    return startFromUrl(session.user.id, body as StartBody);
  } catch (error) {
    return failResponse(error, "Could not start an assembly manual run.");
  }
}

async function startFromUrl(userId: string, body: StartBody): Promise<Response> {
  const result = await withRls({ userId }, async (client) => {
    const membership = await resolveMembership(client, userId);
    requireLead(membership);

    let url = String(body.url ?? "").trim();
    if (!url && body.documentId) {
      const vault = await listOnshapeVaultDocuments(client, membership.orgId);
      const document = vault.find((entry) => entry.id === body.documentId);
      if (!document) throw new HttpError(404, "That CAD vault document is not one of your team's.");
      url = document.externalUrl;
    }
    if (!url) throw new HttpError(400, "Paste an Onshape assembly link, or pick a CAD vault document.");

    let parsed;
    try {
      parsed = parseOnshapeDocumentUrl(url);
    } catch (error) {
      throw new HttpError(400, error instanceof Error ? error.message : "That is not an Onshape document URL.");
    }
    if (!parsed.workspaceId) {
      throw new HttpError(
        400,
        "That link has no workspace in it. Open the assembly tab in Onshape and paste that link (.../w/<workspace>/e/<element>).",
      );
    }

    const onshape = await onshapeFor(client, membership.orgId, userId);
    if (!onshape.ok) {
      // Setup-required, not a failure: the UI turns this into a Connect Onshape link.
      return { status: "not_connected" as const, message: onshape.message };
    }

    const elements = await listAssemblyElements(onshape.http, parsed.documentId, parsed.workspaceId);
    const assemblies = elements.filter((element) => /assembly/i.test(element.elementType));
    if (!assemblies.length) {
      return {
        status: "no_assembly" as const,
        message:
          "That Onshape document has no assembly tab. A manual is built from an assembly — its mates are what say how the robot goes together. Create one, mate it, and try again.",
      };
    }

    const requested = String(body.elementId ?? parsed.elementId ?? "").trim();
    const chosen = assemblies.find((element) => element.id === requested);
    if (!chosen) {
      return {
        status: "choose_assembly" as const,
        message: "Pick which assembly to build the manual from.",
        documentId: parsed.documentId,
        workspaceId: parsed.workspaceId,
        assemblies,
      };
    }

    const run = await startRun(client, {
      orgId: membership.orgId,
      userId,
      sourceKind: body.documentId ? "vault" : "url",
      sourceDocumentId: body.documentId ?? null,
      onshapeUrl: `https://cad.onshape.com/documents/${parsed.documentId}/w/${parsed.workspaceId}/e/${chosen.id}`,
      documentId: parsed.documentId,
      workspaceId: parsed.workspaceId,
      elementId: chosen.id,
      assemblyName: chosen.name,
    });

    return { status: "queued" as const, runId: run.id, assemblyName: chosen.name };
  });

  return Response.json(result);
}

/**
 * Re-word ONE step, on request, using the org's own metered adapter.
 *
 * The same grounding rule as the worker: a sentence whose numbers are not in
 * the step's own facts is thrown away and the deterministic sentence stands.
 * The model cannot change what the step does, only how it reads.
 */
async function rewriteStep(userId: string, body: RewriteBody): Promise<Response> {
  const runId = String(body.runId ?? "").trim();
  const stepNumber = Number(body.stepNumber);
  if (!runId || !Number.isInteger(stepNumber) || stepNumber < 1) {
    throw new HttpError(400, "Say which run and which step to re-word.");
  }

  const result = await withRls({ userId }, async (client) => {
    const membership = await resolveMembership(client, userId);
    requireLead(membership);

    const stepRow = await client.query<{
      title: string;
      subassembly: string;
      parts: Array<{ instanceId: string; name: string; quantity: number }>;
      fabrication: Array<{ text: string }>;
      feasibility: { prerequisites?: string[]; notes?: string[] };
    }>(
      `SELECT s.title, s.subassembly, s.parts, s.fabrication, s.feasibility
         FROM assembly_manual_steps s
        WHERE s.org_id = $1::uuid AND s.run_id = $2::uuid AND s.step_number = $3::int`,
      [membership.orgId, runId, stepNumber],
    );
    const step = stepRow.rows[0];
    if (!step) throw new HttpError(404, "That step is not in this run.");

    const facts: StepWriteFacts = {
      stepNumber,
      primaryName: step.title,
      quantity: 1,
      subassembly: step.subassembly,
      attachesTo: (step.feasibility?.prerequisites ?? []).slice(0, 4),
      hardware: (step.parts ?? [])
        .filter((part) => part.name !== step.title)
        .map((part) => `${part.quantity} x ${part.name}`),
      fabrication: (step.fabrication ?? []).map((line) => line.text),
      cautions: step.feasibility?.notes ?? [],
    };

    const promptCachingEnabled = await getOrgPromptCachingEnabled(client, membership.orgId);
    const adapter = await resolveOrgChatAdapter(client, {
      orgId: membership.orgId,
      userId,
      promptCachingEnabled,
      feature: "assembly_manual",
      bridgeTransport: createBridgeTransport(),
    });

    const prompt = [
      "Rewrite this one assembly-manual step as a single short imperative sentence for a printed build book.",
      "Use ONLY the facts below. Never state a torque, thread-locker, lubricant, tolerance or any number not present.",
      "Reply with ONLY the sentence.",
      "",
      `part: ${facts.primaryName}`,
      facts.subassembly ? `sub-assembly: ${facts.subassembly}` : "",
      facts.attachesTo.length ? `attaches to: ${facts.attachesTo.join(", ")}` : "",
      ...facts.hardware.map((item) => `hardware: ${item}`),
      ...facts.fabrication.map((item) => `fabrication: ${item}`),
      ...facts.cautions.map((item) => `caution: ${item}`),
    ]
      .filter(Boolean)
      .join("\n");

    const raw = await meteredAI({
      client,
      orgId: membership.orgId,
      userId,
      feature: "assembly_manual",
      requestId: randomUUID(),
      estimatedCostUsd: 0.001,
      estimatedPromptTokens: Math.ceil(prompt.length / 4),
      estimatedCompletionTokens: 60,
      provider: adapter.provider,
      model: adapter.model,
      metadata: { action: "assembly_manual_rewrite_step", runId, stepNumber },
      invoke: async () => {
        const completion = await adapter.complete({ message: prompt, context: [], promptCachingEnabled });
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

    const candidate = raw.trim().split("\n")[0]?.replace(/^["'`]|["'`]$/g, "").trim() ?? "";
    const accepted = candidate.length > 0 && candidate.length <= 320 && sentenceIsGrounded(candidate, facts);
    const sentence = accepted ? candidate : deterministicSentence(facts);

    await client.query(
      `UPDATE assembly_manual_steps
          SET sentence = $4::text, sentence_source = $5::text
        WHERE org_id = $1::uuid AND run_id = $2::uuid AND step_number = $3::int`,
      [membership.orgId, runId, stepNumber, sentence, accepted ? "model" : "deterministic"],
    );

    return {
      sentence,
      source: accepted ? ("model" as const) : ("deterministic" as const),
      rejected: !accepted && candidate.length > 0,
      message: accepted
        ? ""
        : "The model's sentence mentioned something the CAD facts do not support, so the plain sentence was kept. Nothing about the step changed.",
    };
  });

  return Response.json(result);
}
