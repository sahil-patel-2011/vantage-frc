import { describe,expect,it } from "vitest";
import { DeterministicMockCadAdapter,planCadKnowledgeToolCalls,validateCadPlan } from "../src";
import { FUSION_RELAY_PROTOCOL_VERSION,pairingState,signFusionRelayJob,verifyFusionRelayJob } from "../src/fusion-relay";
describe("CAD safety contracts",()=>{
 it("requires approval and rejects non-allowlisted or over-complex plans",()=>{
  expect(()=>validateCadPlan([{operation:"create_extrude",parameters:{depth:"25 mm"},requiresApproval:false,reason:"test"}])).toThrow("requires approval");
  expect(()=>validateCadPlan([{operation:"delete_document" as never,parameters:{},requiresApproval:true,reason:"test"}])).toThrow("not allowlisted");
  expect(()=>validateCadPlan(Array.from({length:51},()=>({operation:"create_sketch" as const,parameters:{},requiresApproval:true,reason:"test"})))).toThrow("complexity");
 });
 it("plans knowledge.search so CAD briefs can retrieve wiki/decisions",()=>{
  const explicit=planCadKnowledgeToolCalls("Why did we choose the climber design review envelope?");
  expect(explicit.some((call)=>call.name==="knowledge.search")).toBe(true);
  const implicit=planCadKnowledgeToolCalls("Design a 2-stage elevator within last year's weight budget");
  expect(implicit.some((call)=>call.name==="knowledge.search")).toBe(true);
 });
 it("re-exports metered CAD brief factory used by CadRepository and strategy tools",async()=>{
  const mod=await import("../src");
  expect(typeof mod.createMeteredCadBriefJob).toBe("function");
  expect(typeof mod.planCadStrategyToolCalls).toBe("function");
  expect(mod.planCadStrategyToolCalls("intake",{seasonYear:2026}).some((c)=>c.name==="kickoff.intelligence")).toBe(true);
 });
 it("verifies topology and render after deterministic mutations",async()=>{
  const adapter=new DeterministicMockCadAdapter(),action={operation:"create_extrude" as const,parameters:{depth:"25 mm"},requiresApproval:true,reason:"confirmed"};
  const first=await adapter.execute(action,{jobId:"job-a",idempotencyKey:"one"}),second=await adapter.execute(action,{jobId:"job-a",idempotencyKey:"two"});
  expect(first.topology.fingerprint).not.toBe(second.topology.fingerprint);expect(first.render.content).toContain("Checkpoint");
 });
 it("signs expiring Fusion local relay jobs",()=>{
  const unsigned={version:FUSION_RELAY_PROTOCOL_VERSION,jobId:"job-a",stepId:"step-a",orgId:"org-a",userId:"user-a",deviceId:"device-a",machineName:"pit-laptop",nonce:"nonce-a",leaseToken:"lease",operation:{operation:"create_sketch" as const,parameters:{},requiresApproval:true,reason:"approved"},issuedAt:new Date(0).toISOString(),expiresAt:new Date(Date.now()+60_000).toISOString()};
  const signed=signFusionRelayJob(unsigned,"fixture-secret");expect(verifyFusionRelayJob(signed,"fixture-secret")).toBe(true);expect(verifyFusionRelayJob({...signed,jobId:"guessed-job"},"fixture-secret")).toBe(false);
  expect(verifyFusionRelayJob({...signed,orgId:"wrong-org"},"fixture-secret")).toBe(false);
  expect(verifyFusionRelayJob({...signed,deviceId:"wrong-device"},"fixture-secret")).toBe(false);
 });
 it("makes pairing expiry and consumption terminal",()=>{const now=1000;expect(pairingState({expiresAt:999,approved:false,consumed:false},now)).toBe("expired");expect(pairingState({expiresAt:2000,approved:true,consumed:true},now)).toBe("consumed");expect(pairingState({expiresAt:2000,approved:false,consumed:false},now)).toBe("pending");});
});
