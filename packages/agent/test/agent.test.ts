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
