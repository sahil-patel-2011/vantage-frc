import type { PoolClient } from "@neondatabase/serverless";
import { isToolAllowed, loadOrgAiPolicy } from "@vantage/billing";
import type { AIToolRegistry, ToolDefinition, ToolExecutionContext } from "./orchestrator";

/**
 * AI write actions are proposals until a person confirms them.
 *
 * A model turn is steered by everything in its context — scouting notes, teammates' chat, web
 * pages. A tool that writes on the model's say-so turns any of that text into a purchase request
 * or a CAD job with the asker's name on it. So the registry's write tools do not write: they
 * store a row in `ai_action_proposals` (migration 0673) and return `status: "proposed"`. The UI
 * shows "Proposed by AI — Confirm / Discard"; Confirm replays the tool through
 * {@link decideAiActionProposal} as the CONFIRMING user, on their own RLS session — never with
 * more privilege than that person pressing a button on the page.
 *
 * Read tools are untouched.
 */

/** Every registry tool that changes data. Adding a write tool means adding it here. */
export const AI_WRITE_TOOLS = {
  "finance.create_purchase_request": {
    label: "Purchase request",
    href: (orgId: string) => `/orders?orgId=${encodeURIComponent(orgId)}`,
  },
  "cad.create_brief": {
    label: "CAD engineering brief",
    href: (orgId: string) => `/cad?orgId=${encodeURIComponent(orgId)}`,
  },
} as const;

export type AiWriteToolName = keyof typeof AI_WRITE_TOOLS;

export function isAiWriteTool(name: string): name is AiWriteToolName {
  return Object.prototype.hasOwnProperty.call(AI_WRITE_TOOLS, name);
}

export type ProposedActionOutput = {
  status: "proposed" | "setup_required";
  requiresConfirmation: true;
  proposalId: string | null;
  toolName: string;
  summary: string;
  message: string;
};

export function isProposedActionOutput(value: unknown): value is ProposedActionOutput {
  return Boolean(
    value &&
      typeof value === "object" &&
      (value as Record<string, unknown>).requiresConfirmation === true &&
      typeof (value as Record<string, unknown>).toolName === "string",
  );
}

export const PROPOSALS_NOT_MIGRATED_MESSAGE =
  "AI actions need a database update before they can be proposed (migration 0673). Nothing was changed.";

/**
 * Store a pending proposal for `toolName` with its already-parsed input.
 *
 * Runs on the asker's client. If the table is missing, says so and changes nothing — it never
 * falls back to running the write directly.
 */
export async function proposeAiAction(
  context: ToolExecutionContext,
  proposal: { toolName: string; input: unknown; summary: string },
): Promise<ProposedActionOutput> {
  const summary = proposal.summary.trim().slice(0, 600) || proposal.toolName;
  try {
    const inserted = await context.client.query<{ id: string }>(
      `INSERT INTO ai_action_proposals (org_id, proposed_by, run_id, tool_name, input, summary)
       VALUES ($1::uuid, $2::uuid, $3::uuid, $4, $5::jsonb, $6)
       RETURNING id`,
      [
        context.orgId,
        context.userId,
        context.runId ?? null,
        proposal.toolName,
        JSON.stringify(proposal.input ?? {}),
        summary,
      ],
    );
    const proposalId = inserted.rows[0]?.id ?? null;
    if (proposalId) {
      await context.client.query(
        `INSERT INTO ai_action_proposal_events (org_id, proposal_id, actor_user_id, action, detail)
         VALUES ($1::uuid, $2::uuid, $3::uuid, 'proposed', $4::jsonb)`,
        [context.orgId, proposalId, context.userId, JSON.stringify({ toolName: proposal.toolName, runId: context.runId ?? null })],
      );
    }
    return {
      status: "proposed",
      requiresConfirmation: true,
      proposalId,
      toolName: proposal.toolName,
      summary,
      message: `Proposed, not done yet: ${summary}. Nothing changes until you press Confirm on the proposal card.`,
    };
  } catch {
    return {
      status: "setup_required",
      requiresConfirmation: true,
      proposalId: null,
      toolName: proposal.toolName,
      summary,
      message: PROPOSALS_NOT_MIGRATED_MESSAGE,
    };
  }
}

/**
 * Wrap a write tool so a model turn only proposes it.
 *
 * `precheck` runs first on the asker's session and may return a refusal (e.g. Finance-in-AI is
 * off) so a proposal that could never be confirmed is not stored.
 */
export function proposalOnly<I, O>(
  definition: ToolDefinition<I, O>,
  options: {
    summarize: (input: I) => string;
    precheck?: (context: ToolExecutionContext, input: I) => Promise<Record<string, unknown> | null>;
  },
): ToolDefinition<I, O> {
  return {
    ...definition,
    description: `${definition.description} Proposes only: the change waits for the person to confirm it.`,
    async execute(context, input) {
      const refusal = options.precheck ? await options.precheck(context, input) : null;
      if (refusal) return refusal as O;
      return (await proposeAiAction(context, {
        toolName: definition.name,
        input,
        summary: options.summarize(input),
      })) as unknown as O;
    },
  };
}

export type AiActionProposalRow = {
  id: string;
  orgId: string;
  proposedBy: string;
  proposedByName: string | null;
  runId: string | null;
  toolName: string;
  input: unknown;
  summary: string;
  status: "pending" | "confirmed" | "discarded" | "failed" | "expired";
  decidedBy: string | null;
  decidedAt: string | null;
  result: unknown;
  error: string | null;
  expiresAt: string;
  createdAt: string;
};

const PROPOSAL_COLUMNS = `p.id, p.org_id AS "orgId", p.proposed_by AS "proposedBy", u.name AS "proposedByName",
  p.run_id AS "runId", p.tool_name AS "toolName", p.input, p.summary, p.status,
  p.decided_by AS "decidedBy", p.decided_at::text AS "decidedAt", p.result, p.error,
  p.expires_at::text AS "expiresAt", p.created_at::text AS "createdAt"`;

/** Pending (and recent) proposals this member may see — RLS limits it to their own, or all for owners/admins. */
export async function listAiActionProposals(
  client: PoolClient,
  input: { orgId: string; status?: "pending" | "all"; limit?: number },
): Promise<AiActionProposalRow[]> {
  const limit = Math.min(100, Math.max(1, Math.floor(input.limit ?? 25)));
  const rows = await client.query<AiActionProposalRow>(
    `SELECT ${PROPOSAL_COLUMNS}
       FROM ai_action_proposals p
       LEFT JOIN users u ON u.id = p.proposed_by
      WHERE p.org_id = $1::uuid
        AND ($2::text = 'all' OR (p.status = 'pending' AND p.expires_at > now()))
      ORDER BY p.created_at DESC
      LIMIT $3`,
    [input.orgId, input.status ?? "pending", limit],
  );
  return rows.rows;
}

export class AiActionProposalError extends Error {
  constructor(
    readonly status: 400 | 403 | 404 | 409 | 410,
    message: string,
  ) {
    super(message);
    this.name = "AiActionProposalError";
  }
}

export type AiActionDecision = "confirm" | "discard";

export type AiActionDecisionResult = {
  proposalId: string;
  status: "confirmed" | "discarded" | "failed";
  toolName: string;
  result: Record<string, unknown> | null;
  error: string | null;
  href: string | null;
};

/** A tool result that says the write did not happen. */
export function toolResultFailed(result: unknown): string | null {
  if (!result || typeof result !== "object") return "The action returned nothing.";
  const row = result as Record<string, unknown>;
  if (row.denied) return String(row.message ?? "Refused by team policy.");
  if (row.created === false || row.status === "failed" || row.setup_required === true) {
    return String(row.error ?? row.message ?? "The action did not complete.");
  }
  return null;
}

async function recordEvent(
  client: PoolClient,
  input: { orgId: string; proposalId: string; userId: string; action: "confirmed" | "discarded" | "failed"; detail: Record<string, unknown> },
) {
  await client.query(
    `INSERT INTO ai_action_proposal_events (org_id, proposal_id, actor_user_id, action, detail)
     VALUES ($1::uuid, $2::uuid, $3::uuid, $4, $5::jsonb)`,
    [input.orgId, input.proposalId, input.userId, input.action, JSON.stringify(input.detail)],
  );
}

/**
 * Confirm or discard one proposal, as `userId`, on that user's RLS client.
 *
 * - Only the proposing user or an owner/admin may decide (checked here and by RLS).
 * - Confirm replays the tool through a commit-mode registry with the CONFIRMING user as the
 *   actor, after re-checking the team's AI tool policy. Row-locked, so a double click runs once.
 * - Both outcomes are written to `ai_action_proposal_events`.
 */
export async function decideAiActionProposal(
  client: PoolClient,
  input: {
    orgId: string;
    userId: string;
    proposalId: string;
    decision: AiActionDecision;
    /** Injected in tests; defaults to `createVantageToolRegistry({ writeMode: "commit" })`. */
    registry?: AIToolRegistry;
  },
): Promise<AiActionDecisionResult> {
  const found = await client.query<{
    id: string;
    proposedBy: string;
    toolName: string;
    input: unknown;
    status: string;
    expired: boolean;
  }>(
    `SELECT id, proposed_by AS "proposedBy", tool_name AS "toolName", input, status,
            (expires_at <= now()) AS expired
       FROM ai_action_proposals
      WHERE id = $1::uuid AND org_id = $2::uuid
      FOR UPDATE`,
    [input.proposalId, input.orgId],
  );
  const proposal = found.rows[0];
  if (!proposal) throw new AiActionProposalError(404, "That AI proposal was not found, or it is not yours to decide.");

  if (proposal.proposedBy !== input.userId) {
    const role = await client.query<{ allowed: boolean }>(
      `SELECT has_org_role($1::uuid, ARRAY['owner','admin']::org_role[]) AS allowed`,
      [input.orgId],
    );
    if (!role.rows[0]?.allowed) {
      throw new AiActionProposalError(403, "Only the person who asked, or a team owner or admin, can decide this proposal.");
    }
  }
  if (proposal.status !== "pending") {
    throw new AiActionProposalError(409, `This proposal was already ${proposal.status}.`);
  }
  if (!isAiWriteTool(proposal.toolName)) {
    throw new AiActionProposalError(400, "This proposal names a tool that no longer changes data here.");
  }

  const decide = async (
    status: "confirmed" | "discarded" | "failed",
    result: Record<string, unknown> | null,
    error: string | null,
  ): Promise<AiActionDecisionResult> => {
    await client.query(
      `UPDATE ai_action_proposals
          SET status = $3, decided_by = $4::uuid, decided_at = now(), result = $5::jsonb, error = $6
        WHERE id = $1::uuid AND org_id = $2::uuid AND status = 'pending'`,
      [input.proposalId, input.orgId, status, input.userId, result ? JSON.stringify(result) : null, error],
    );
    await recordEvent(client, {
      orgId: input.orgId,
      proposalId: input.proposalId,
      userId: input.userId,
      action: status,
      detail: { toolName: proposal.toolName, error, onBehalfOf: proposal.proposedBy },
    });
    return {
      proposalId: input.proposalId,
      status,
      toolName: proposal.toolName,
      result,
      error,
      href: status === "confirmed" ? AI_WRITE_TOOLS[proposal.toolName as AiWriteToolName].href(input.orgId) : null,
    };
  };

  if (input.decision === "discard") return decide("discarded", null, null);

  if (proposal.expired) {
    return decide("failed", null, "This proposal expired. Ask the assistant again if you still want it.");
  }

  const policy = await loadOrgAiPolicy(client, input.orgId);
  if (!isToolAllowed(policy, proposal.toolName)) {
    return decide("failed", null, `Your team's AI policy does not allow ${proposal.toolName}.`);
  }

  const active = await client.query<{ activeEventKey: string | null }>(
    `SELECT active_event_key AS "activeEventKey" FROM org_active_context WHERE org_id = $1::uuid`,
    [input.orgId],
  );
  const registry =
    input.registry ?? (await import("./tools")).createVantageToolRegistry({ writeMode: "commit" });

  let output: unknown;
  try {
    output = await registry.invoke(
      proposal.toolName,
      {
        client,
        orgId: input.orgId,
        // The confirming person is the actor: their RLS, their name on the row.
        userId: input.userId,
        activeEventKey: active.rows[0]?.activeEventKey ?? null,
        runId: null,
      },
      proposal.input,
    );
  } catch (error) {
    return decide("failed", null, error instanceof Error ? error.message.slice(0, 1000) : "The action failed.");
  }
  const result = output && typeof output === "object" ? (output as Record<string, unknown>) : { value: output };
  const failure = toolResultFailed(result);
  return failure ? decide("failed", result, failure.slice(0, 1000)) : decide("confirmed", result, null);
}
