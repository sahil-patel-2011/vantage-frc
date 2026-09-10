import { describe, expect, it } from "vitest";
import {
  Base44WorkspaceConnector,
  boundedContext,
  LocalDeterministicChatAdapter,
  routeModel,
  validateHostedProviderUrl,
  type ModelConfig,
  AIToolRegistry,
  buildUnifiedContext,
  authorizeLocalCliConnector,
  Base44NonceGuard,
  signBase44BridgeRequest,
  verifyBase44BridgeSignature,
  Base44CreditExhaustedError,
} from "../src";

const models: ModelConfig[] = [
  {
    id: "sol",
    displayName: "GPT 5.6 Sol",
    provider: "configured-openai",
    providerModelId: "env-configured-sol",
    inputPricePerMillionUsd: 1,
    outputPricePerMillionUsd: 2,
    capabilities: ["strategy"],
    eligiblePlans: ["managed_20"],
    paygOnly: false,
    enabled: true,
    routingWeight: 1,
    contextWindowTokens: 100_000,
  },
  {
    id: "fable",
    displayName: "Fable 5",
    provider: "configured-fable",
    providerModelId: "env-configured-fable",
    inputPricePerMillionUsd: 3,
    outputPricePerMillionUsd: 6,
    capabilities: ["strategy"],
    eligiblePlans: ["managed_20"],
    paygOnly: true,
    enabled: true,
    routingWeight: 1,
    contextWindowTokens: 100_000,
  },
];

describe("model router", () => {
  it("keeps Fable PAYG-only and out of included allowance", () => {
    expect(
      routeModel(models, {
        capability: "strategy",
        plan: "managed_20",
        paygEnabled: false,
        preferredDisplayName: "Fable 5",
        estimatedInputTokens: 100,
        estimatedOutputTokens: 100,
      }).displayName,
    ).toBe("GPT 5.6 Sol");
    expect(
      routeModel(models, {
        capability: "strategy",
        plan: "managed_20",
        paygEnabled: true,
        preferredDisplayName: "Fable 5",
        estimatedInputTokens: 100,
        estimatedOutputTokens: 100,
      }).billingBucket,
    ).toBe("payg");
  });

  it("never invents a provider model id", () => {
    expect(() =>
      routeModel([{ ...models[0]!, providerModelId: null }], {
        capability: "strategy",
        plan: "managed_20",
        paygEnabled: true,
        estimatedInputTokens: 1,
        estimatedOutputTokens: 1,
      }),
    ).toThrow("No configured model");
  });

  it("prevents free accounts from incurring unmanaged provider cost", () => {
    const freeRequest = {
      capability: "strategy",
      plan: "free",
      accountTier: "free" as const,
      paygEnabled: false,
      estimatedInputTokens: 100,
      estimatedOutputTokens: 100,
    };
    const paid = { ...models[0]!, eligiblePlans: ["free"], fundingMode: "managed_paid" as const };
    expect(() => routeModel([paid], freeRequest)).toThrow("No configured model");
    const unapprovedSponsored = {
      ...paid,
      fundingMode: "sponsored" as const,
      sponsoredEnabled: true,
      commercialUseApproved: false,
    };
    expect(() => routeModel([unapprovedSponsored], freeRequest)).toThrow("No configured model");
    expect(
      routeModel(
        [{
          ...unapprovedSponsored,
          commercialUseApproved: true,
          commercialApprovalSource: "Provider contract 2026-07",
        }],
        freeRequest,
      ).billingBucket,
    ).toBe("sponsored");
  });

  it("keeps Base44 out of generic customer routing", () => {
    expect(() =>
      routeModel(
        [{ ...models[0]!, provider: "base44", eligiblePlans: ["free"], fundingMode: "sponsored" }],
        {
          capability: "strategy",
          plan: "free",
          accountTier: "free",
          paygEnabled: false,
          estimatedInputTokens: 1,
          estimatedOutputTokens: 1,
        },
      ),
    ).toThrow("No configured model");
  });
});

describe("personal local CLI provider policy",()=>{
 const allowed={connector:"claude-code" as const,requestingUserId:"owner",orgId:"owner-org",platformAdmin:true,pairedDeviceUserId:"owner",pairedDeviceOrgId:"owner-org",privacyScope:"private" as const,interactive:true,backgroundJob:false,explicitOptIn:true};
 it("allows only explicit private use on the matching owner device",()=>{
  expect(authorizeLocalCliConnector(allowed).label).toBe("Personal local use only");
  expect(()=>authorizeLocalCliConnector({...allowed,requestingUserId:"member"})).toThrow("platform owner's");
  expect(()=>authorizeLocalCliConnector({...allowed,orgId:"customer-org"})).toThrow("matching paired device");
  expect(()=>authorizeLocalCliConnector({...allowed,privacyScope:"team"})).toThrow("personal local use only");
  expect(()=>authorizeLocalCliConnector({...allowed,backgroundJob:true})).toThrow("background");
 });
});

describe("custom provider boundaries", () => {
  it("blocks metadata/private targets and requires a relay for localhost", async () => {
    await expect(validateHostedProviderUrl("http://localhost:11434/v1")).rejects.toThrow("HTTPS");
    await expect(validateHostedProviderUrl("https://169.254.169.254/latest")).rejects.toThrow("blocked");
    await expect(validateHostedProviderUrl("https://192.168.1.2/v1")).rejects.toThrow("blocked");
  });
  it("keeps Base44 disabled without a documented metered transport", async () => {
    const connector = new Base44WorkspaceConnector({
      enabled: false,
      meteringMode: "unverified",
    });
    await expect(connector.invoke({requestId:"test",orgId:"org",userId:"user",feature:"chat",modelDisplay:"model",messages:[],maxTokens:1})).rejects.toThrow("disabled");
  });
  it("signs narrow requests, rejects replay, and reports credit exhaustion",async()=>{
    const payload={requestId:"req",orgId:"org",userId:"user",feature:"cad" as const,modelDisplay:"gpt_5_4",messages:[{role:"user" as const,content:"brief"}],maxTokens:20,nonce:"nonce",issuedAt:new Date().toISOString()};
    const signature=signBase44BridgeRequest(payload,"secret");
    expect(verifyBase44BridgeSignature(payload,signature,"secret")).toBe(true);
    const guard=new Base44NonceGuard();expect(guard.consume("nonce",Date.now()+1000)).toBe(true);expect(guard.consume("nonce",Date.now()+1000)).toBe(false);
    const connector=new Base44WorkspaceConnector({enabled:true,meteringMode:"unverified",featureFlagEnabled:true,approvalReference:"OEM-1",approvalDate:"2026-07-15",approvalAcknowledged:true,healthVerified:true,appId:"app",bridgeUrl:"https://8.8.8.8/function",signingSecret:"secret",modelMappings:{"Display":"gpt_5_4"}},{invoke:async()=>({content:"",status:402,errorCode:"credits_exhausted"})});
    await expect(connector.invoke({...payload,modelDisplay:"Display"})).rejects.toBeInstanceOf(Base44CreditExhaustedError);
  });
});

describe("bounded private and team context", () => {
  it("honors token budgets and explicit source types", async () => {
    const result = boundedContext([
      { type: "private_memory", id: "private", content: "a".repeat(20), importance: 1 },
      { type: "team_memory", id: "shared", content: "b".repeat(100), importance: 0.5 },
    ], 10);
    expect(result.items.map((item) => item.id)).toEqual(["private"]);
    const chat = await new LocalDeterministicChatAdapter().complete({
      message: "Plan",
      context: result.items,
    });
    expect(chat.text).toContain("private_memory:private");
    expect(chat.costUsd).toBe(0);
  });
});

describe("unified AI orchestration boundaries",()=>{
  it("deduplicates provenance and enforces the shared context budget",()=>{
    const result=buildUnifiedContext([
      {type:"module_data",id:"metric-1",content:"a".repeat(20),importance:1,classification:"hard_metric"},
      {type:"module_data",id:"metric-1",content:"duplicate",importance:.1,classification:"hard_metric"},
      {type:"team_memory",id:"shared-1",content:"b".repeat(100),importance:.5,classification:"team_memory"},
    ],10);
    expect(result.items.map(item=>item.id)).toEqual(["metric-1"]);
    expect(result.provenance[0]?.classification).toBe("hard_metric");
  });
  it("rejects tools outside the typed authorization registry",async()=>{
    const registry=new AIToolRegistry();
    await expect(registry.invoke("direct.sql",{client:{} as never,orgId:"org-a",userId:"user-a",activeEventKey:null},{})).rejects.toThrow("not authorized");
  });
});

describe("chat auto-tool planning", () => {
  it("auto-selects scouting.team and reference.team for scout questions", async () => {
    const { planChatToolCalls, annotateToolOutput, formatGroundedReply } = await import("../src/auto-tools");
    const calls = planChatToolCalls("What did scouting see on team 254 defense?");
    expect(calls.some((call) => call.name === "scouting.team" && (call.input as { teamKey: string }).teamKey === "frc254")).toBe(true);
    expect(calls.some((call) => call.name === "reference.team")).toBe(true);
    const empty = annotateToolOutput("scouting.team", [], { teamKey: "frc254" });
    expect(empty.status).toBe("empty");
    expect(formatGroundedReply("scout 254", [empty])).toContain("nothing was invented");
    const withConflict = annotateToolOutput(
      "scouting.team",
      [
        {
          id: "e1",
          conflictCount: 1,
          excludedFields: ["climb"],
          trustedPayload: { notes: "ok" },
          payload: { climb: "none", notes: "ok" },
        },
      ],
      { teamKey: "frc254" },
    );
    expect(withConflict.summary).toMatch(/TBA conflicts|trustedPayload/i);
    const strategyTrust = annotateToolOutput(
      "strategy.match",
      {
        prediction: { pRed: 0.5 },
        strategy: null,
        scoutTbaConflicts: [{ fieldKey: "climb", status: "conflict" }],
      },
      { matchKey: "2026nysu_qm1" },
    );
    expect(strategyTrust.summary).toMatch(/TBA-contradicted/);
  });

  it("auto-selects strategy.match for matchup questions with event context", async () => {
    const { planChatToolCalls, annotateToolOutput } = await import("../src/auto-tools");
    const calls = planChatToolCalls("Strategy for qual 42 matchup", { activeEventKey: "2026nysu" });
    expect(calls).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "strategy.match", input: { matchKey: "2026nysu_qm42" } }),
      ]),
    );
    const emptyStrategy = annotateToolOutput("strategy.match", { prediction: null, strategy: null }, {
      matchKey: "2026nysu_qm42",
    });
    expect(emptyStrategy.status).toBe("empty");
  });

  it("auto-selects strategy.private_edge for pEPA / why-we-lose questions", async () => {
    const { planChatToolCalls, annotateToolOutput } = await import("../src/auto-tools");
    const calls = planChatToolCalls("Why we lose to 254 — show pEPA and climb accuracy", {
      activeEventKey: "2026miket",
    });
    expect(calls).toEqual(
      expect.arrayContaining([expect.objectContaining({ name: "strategy.private_edge" })]),
    );
    const empty = annotateToolOutput("strategy.private_edge", { status: "empty", teams: [], eventKey: "2026miket" });
    expect(empty.status).toBe("empty");
  });

  it("does not invent tool calls for unrelated chat", async () => {
    const { planChatToolCalls } = await import("../src/auto-tools");
    expect(planChatToolCalls("Thanks — remind me how private memory works.")).toEqual([]);
  });

  it("plans finance.orders for open purchase-request questions", async () => {
    const { planChatToolCalls, annotateToolOutput } = await import("../src/auto-tools");
    const calls = planChatToolCalls("What purchase requests are awaiting approval?");
    expect(calls.some((call) => call.name === "finance.orders")).toBe(true);
    const empty = annotateToolOutput("finance.orders", { orders: [], financeAiEnabled: false, aiSummary: null });
    expect(empty.status).toBe("empty");
  });

  it("plans finance.summary for budget/spend questions and annotates deny", async () => {
    const { planChatToolCalls, annotateToolOutput } = await import("../src/auto-tools");
    const calls = planChatToolCalls("How much did we spend this season against budget?");
    expect(calls.some((call) => call.name === "finance.summary")).toBe(true);
    const denied = annotateToolOutput(
      "finance.summary",
      {
        denied: true,
        setup_required: true,
        reason: "finance_in_ai.disabled",
        message: "Finance-in-AI is off.",
      },
      { seasonYear: 2026 },
    );
    expect(denied.status).toBe("setup_required");
    expect(denied.summary).toContain("Finance-in-AI");
  });

  it("plans finance.create_purchase_request when CAD needs a part", async () => {
    const { planChatToolCalls } = await import("../src/auto-tools");
    const calls = planChatToolCalls("Need part NEO 550 for the intake roller", { capability: "cad" });
    expect(calls.some((call) => call.name === "finance.create_purchase_request")).toBe(true);
    expect(calls.some((call) => call.name === "finance.orders")).toBe(true);
    const create = calls.find((call) => call.name === "finance.create_purchase_request");
    expect((create?.input as { source?: string }).source).toBe("cad");
  });

  it("auto-selects knowledge.search for wiki / decision history questions", async () => {
    const { planChatToolCalls, annotateToolOutput } = await import("../src/auto-tools");
    const calls = planChatToolCalls("Why did we choose swerve over tank last season?");
    expect(calls.some((call) => call.name === "knowledge.search")).toBe(true);
    const empty = annotateToolOutput("knowledge.search", [], { query: "swerve" });
    expect(empty.status).toBe("empty");
    expect(empty.summary).toMatch(/No wiki/);
  });

  it("CAD capability plans knowledge retrieval for briefs", async () => {
    const { planChatToolCalls } = await import("../src/auto-tools");
    const calls = planChatToolCalls("Design a 2-stage elevator", { capability: "cad" });
    expect(calls.some((call) => call.name === "knowledge.search")).toBe(true);
    expect(calls.some((call) => call.name === "cad.vault")).toBe(true);
  });

  it("plans the CAD vault for a heavy-part question", async () => {
    const { planChatToolCalls, annotateToolOutput } = await import("../src/auto-tools");
    const calls = planChatToolCalls("why is this part heavy");
    expect(calls.some((call) => call.name === "cad.vault")).toBe(true);
    const empty = annotateToolOutput("cad.vault", []);
    expect(empty.status).toBe("empty");
    expect(empty.summary).toMatch(/vault/i);
  });
});
