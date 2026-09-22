import { describe, expect, it, vi } from "vitest";
import { FINANCE_IN_AI_ACK_VERSION } from "@vantage/billing/ai-policy";
import {
  AIToolRegistry,
  AiActionProposalError,
  createVantageToolRegistry,
  decideAiActionProposal,
  isAiWriteTool,
  proposalOnly,
  toolResultFailed,
} from "../src";

const ORG = "00000000-0000-4000-8000-000000000001";
const ASKER = "00000000-0000-4000-8000-00000000000a";
const ADMIN = "00000000-0000-4000-8000-00000000000b";
const OTHER = "00000000-0000-4000-8000-00000000000c";
const PROPOSAL = "00000000-0000-4000-8000-0000000000ff";

type Call = { sql: string; params: unknown[] };

/** A PoolClient stand-in that answers by SQL shape and records every statement. */
function mockClient(handlers: Array<[RegExp, (params: unknown[]) => { rows: unknown[]; rowCount?: number }]>) {
  const calls: Call[] = [];
  const client = {
    calls,
    query: vi.fn(async (sql: string, params: unknown[] = []) => {
      calls.push({ sql, params });
      if (/^\s*(SAVEPOINT|RELEASE|ROLLBACK)/i.test(sql)) throw new Error("no transaction in unit test");
      for (const [pattern, handler] of handlers) {
        if (pattern.test(sql)) {
          const result = handler(params);
          return { rows: result.rows, rowCount: result.rowCount ?? result.rows.length };
        }
      }
      return { rows: [], rowCount: 0 };
    }),
  };
  return client;
}

function financeAllowedPolicy() {
  return {
    rows: [
      {
        finance_in_ai_enabled: true,
        finance_in_ai_accepted_at: new Date().toISOString(),
        finance_in_ai_ack_version: FINANCE_IN_AI_ACK_VERSION,
        tool_allowlist_enabled: false,
      },
    ],
  };
}

describe("AI write tools only propose", () => {
  it("both registry write tools are in the write list; read tools are not", () => {
    expect(isAiWriteTool("finance.create_purchase_request")).toBe(true);
    expect(isAiWriteTool("cad.create_brief")).toBe(true);
    expect(isAiWriteTool("finance.orders")).toBe(false);
    expect(isAiWriteTool("scouting.team")).toBe(false);
  });

  it("a model-turn call to cad.create_brief stores a proposal and writes nothing else", async () => {
    const client = mockClient([
      [/INSERT INTO ai_action_proposals/, () => ({ rows: [{ id: PROPOSAL }] })],
    ]);
    const registry = createVantageToolRegistry();
    const output = (await registry.invoke(
      "cad.create_brief",
      { client: client as never, orgId: ORG, userId: ASKER, activeEventKey: null, runId: null },
      { request: "Design a lighter intake", title: "Lighter intake" },
    )) as Record<string, unknown>;
    expect(output.status).toBe("proposed");
    expect(output.proposalId).toBe(PROPOSAL);
    expect(output.requiresConfirmation).toBe(true);
    const writes = client.calls.filter((c) => /INSERT|UPDATE|DELETE/i.test(c.sql));
    expect(writes.map((c) => c.sql.match(/INSERT INTO (\w+)/)?.[1])).toEqual([
      "ai_action_proposals",
      "ai_action_proposal_events",
    ]);
    expect(client.calls.some((c) => /cad_jobs/.test(c.sql))).toBe(false);
    // Proposed as the asker.
    expect(client.calls.find((c) => /INSERT INTO ai_action_proposals/.test(c.sql))!.params[1]).toBe(ASKER);
  });

  it("purchase requests are refused up front when Finance-in-AI is off — no proposal stored", async () => {
    const client = mockClient([[/FROM org_ai_policies/, () => ({ rows: [] })]]);
    const registry = createVantageToolRegistry();
    const output = (await registry.invoke(
      "finance.create_purchase_request",
      { client: client as never, orgId: ORG, userId: ASKER, activeEventKey: null },
      { title: "NEO motor", justification: "spare", quantity: 2, estimateUsd: 100 },
    )) as Record<string, unknown>;
    expect(output.denied).toBe(true);
    expect(client.calls.some((c) => /INSERT/i.test(c.sql))).toBe(false);
  });

  it("purchase requests become a proposal, never a purchase_requests row, from a model turn", async () => {
    const client = mockClient([
      [/FROM org_ai_policies/, financeAllowedPolicy],
      [/INSERT INTO ai_action_proposals/, () => ({ rows: [{ id: PROPOSAL }] })],
    ]);
    const output = (await createVantageToolRegistry().invoke(
      "finance.create_purchase_request",
      { client: client as never, orgId: ORG, userId: ASKER, activeEventKey: null },
      { title: "NEO motor", justification: "spare", quantity: 2, estimateUsd: 100, vendor: "REV" },
    )) as Record<string, unknown>;
    expect(output.status).toBe("proposed");
    expect(String(output.summary)).toContain("2 × NEO motor");
    expect(client.calls.some((c) => /purchase_requests/.test(c.sql))).toBe(false);
  });

  it("if the proposals table is missing it says so and still writes nothing", async () => {
    const client = mockClient([
      [/INSERT INTO ai_action_proposals/, () => {
        throw new Error('relation "ai_action_proposals" does not exist');
      }],
    ]);
    const inner = vi.fn(async () => ({ created: true }));
    const registry = new AIToolRegistry().register(
      proposalOnly(
        { name: "cad.create_brief", description: "x", parseInput: (v) => v, parseOutput: (v) => v as Record<string, unknown>, execute: inner },
        { summarize: () => "Make a brief" },
      ),
    );
    const output = (await registry.invoke("cad.create_brief", { client: client as never, orgId: ORG, userId: ASKER, activeEventKey: null }, {})) as Record<string, unknown>;
    expect(output.status).toBe("setup_required");
    expect(inner).not.toHaveBeenCalled();
  });
});

describe("confirming or discarding a proposal", () => {
  function proposalRow(overrides: Record<string, unknown> = {}) {
    return {
      rows: [
        {
          id: PROPOSAL,
          proposedBy: ASKER,
          toolName: "cad.create_brief",
          input: { request: "Design a lighter intake", title: "Lighter intake" },
          status: "pending",
          expired: false,
          ...overrides,
        },
      ],
    };
  }

  function commitRegistry(
    execute: ReturnType<typeof vi.fn<() => Promise<Record<string, unknown>>>> = vi.fn(
      async (): Promise<Record<string, unknown>> => ({ jobId: "job-1", status: "completed" }),
    ),
  ) {
    const registry = new AIToolRegistry().register({
      name: "cad.create_brief",
      description: "commit",
      parseInput: (v: unknown) => v,
      parseOutput: (v: unknown) => v as Record<string, unknown>,
      execute,
    });
    return { registry, execute };
  }

  it("a teammate who is neither the asker nor an admin cannot decide it", async () => {
    const client = mockClient([
      [/FROM ai_action_proposals/, () => proposalRow()],
      [/has_org_role/, () => ({ rows: [{ allowed: false }] })],
    ]);
    const { registry, execute } = commitRegistry();
    await expect(
      decideAiActionProposal(client as never, { orgId: ORG, userId: OTHER, proposalId: PROPOSAL, decision: "confirm", registry }),
    ).rejects.toMatchObject({ status: 403 });
    expect(execute).not.toHaveBeenCalled();
    expect(client.calls.some((c) => /UPDATE ai_action_proposals/.test(c.sql))).toBe(false);
  });

  it("an admin confirming runs the write as the ADMIN, not the asker, and audits it", async () => {
    const client = mockClient([
      [/FROM ai_action_proposals/, () => proposalRow()],
      [/has_org_role/, () => ({ rows: [{ allowed: true }] })],
      [/FROM org_ai_policies/, () => ({ rows: [] })],
      [/FROM org_active_context/, () => ({ rows: [{ activeEventKey: "2026casj" }] })],
    ]);
    const { registry, execute } = commitRegistry();
    const result = await decideAiActionProposal(client as never, {
      orgId: ORG,
      userId: ADMIN,
      proposalId: PROPOSAL,
      decision: "confirm",
      registry,
    });
    expect(result.status).toBe("confirmed");
    expect(execute).toHaveBeenCalledTimes(1);
    const [context] = execute.mock.calls[0] as unknown as [{ userId: string; orgId: string }];
    expect(context.userId).toBe(ADMIN);
    const update = client.calls.find((c) => /UPDATE ai_action_proposals/.test(c.sql))!;
    expect(update.params).toContain("confirmed");
    expect(update.params).toContain(ADMIN);
    const event = client.calls.find((c) => /INSERT INTO ai_action_proposal_events/.test(c.sql))!;
    expect(event.params).toContain("confirmed");
    expect(JSON.parse(String(event.params[4]))).toMatchObject({ onBehalfOf: ASKER });
    // The row was locked before the write, so a double click cannot run it twice.
    expect(client.calls.find((c) => /FROM ai_action_proposals/.test(c.sql))!.sql).toMatch(/FOR UPDATE/);
  });

  it("discard never runs the tool and is recorded", async () => {
    const client = mockClient([[/FROM ai_action_proposals/, () => proposalRow()]]);
    const { registry, execute } = commitRegistry();
    const result = await decideAiActionProposal(client as never, {
      orgId: ORG,
      userId: ASKER,
      proposalId: PROPOSAL,
      decision: "discard",
      registry,
    });
    expect(result.status).toBe("discarded");
    expect(execute).not.toHaveBeenCalled();
    expect(client.calls.some((c) => /ai_action_proposal_events/.test(c.sql) && c.params.includes("discarded"))).toBe(true);
  });

  it("an already-decided proposal cannot run again", async () => {
    const client = mockClient([[/FROM ai_action_proposals/, () => proposalRow({ status: "confirmed" })]]);
    const { registry, execute } = commitRegistry();
    await expect(
      decideAiActionProposal(client as never, { orgId: ORG, userId: ASKER, proposalId: PROPOSAL, decision: "confirm", registry }),
    ).rejects.toBeInstanceOf(AiActionProposalError);
    expect(execute).not.toHaveBeenCalled();
  });

  it("the team's tool allowlist is re-checked at confirm time", async () => {
    const client = mockClient([
      [/FROM ai_action_proposals/, () => proposalRow()],
      [/FROM org_ai_policies/, () => ({ rows: [{ tool_allowlist_enabled: true, allowed_tools: ["scouting.team"] }] })],
    ]);
    const { registry, execute } = commitRegistry();
    const result = await decideAiActionProposal(client as never, {
      orgId: ORG,
      userId: ASKER,
      proposalId: PROPOSAL,
      decision: "confirm",
      registry,
    });
    expect(result.status).toBe("failed");
    expect(execute).not.toHaveBeenCalled();
  });

  it("a write that reports failure is recorded as failed, not confirmed", async () => {
    const client = mockClient([
      [/FROM ai_action_proposals/, () => proposalRow()],
      [/FROM org_ai_policies/, () => ({ rows: [] })],
    ]);
    const { registry } = commitRegistry(vi.fn(async () => ({ created: false, error: "RLS refused" })));
    const result = await decideAiActionProposal(client as never, {
      orgId: ORG,
      userId: ASKER,
      proposalId: PROPOSAL,
      decision: "confirm",
      registry,
    });
    expect(result.status).toBe("failed");
    expect(result.error).toContain("RLS refused");
    expect(toolResultFailed({ jobId: "x", status: "completed" })).toBeNull();
  });
});
