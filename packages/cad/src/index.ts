import { createHash,randomBytes } from "node:crypto";
import type { PoolClient } from "@neondatabase/serverless";
import {
  createMeteredCadBriefJob,
  planCadStrategyToolCalls,
  type ContextSource,
} from "@vantage/agent";
import { VERIFY_CAD_OPERATIONS, type CadTeamProfile, type CadUserPreferences } from "./agent-policy";
import type { CadExecutionResult } from "./fusion-relay";
export * from "./fusion-relay";
export {
  CAD_AGENT_SYSTEM_PROMPT,
  DESTRUCTIVE_CAD_OPERATIONS,
  VERIFY_CAD_OPERATIONS,
  sanitizeUntrustedCadText,
  isAllowlistedCadOperation,
  requiresDestructiveConfirmation,
  canAutoRunWithinAllowlist,
  buildDefaultCadPlan,
  buildAdaptiveCadContext,
  DEFAULT_CAD_TEAM_PROFILE,
  DEFAULT_CAD_USER_PREFERENCES,
  describeCadBrainMode,
  cadenceAgentPlanningPrompt,
} from "./agent-policy";
export type { CadBrainMode, CadSetupTarget, CadTeamProfile, CadUserPreferences, EngineeringBriefLite } from "./agent-policy";
export * from "./mock-fusion-plugin";
export * from "./agent-loop";
export * from "./onshape";
export { firstPlannedId } from "./first-planned-id";
export * from "./onshape-native-dispatch";
export * from "./onshape-native-entities";
export {
  inferOnshapeVariableType,
  isOnshapeVariableStudio,
  listOnshapeNativeVariables,
  onshapeVariablesPath,
  parseOnshapeVariables,
  pickVariableStudioElementId,
  requireOnshapeVariableExpression,
  requireOnshapeVariableName,
  setOnshapeNativeVariable,
} from "./onshape-native-variables";
export type {
  OnshapeNativeVariable,
  OnshapeNativeVariableResult,
  OnshapeNativeVariablesDocument,
  OnshapeNativeVariablesHttp,
  OnshapeVariableType,
} from "./onshape-native-variables";
export * from "./compatibility";
export * from "./ai-plan";
export * from "./onshape-api-keys";
export type { OnshapeMateType, OnshapeAssemblyRef } from "./onshape-assemblies";
export {
  onshapeAssemblyPath,
  createOnshapePartStudio,
  getOnshapeBodyDetails,
  summarizeOnshapeBodyDetails,
  createOnshapeAssembly,
  getOnshapeAssembly,
  addOnshapeAssemblyInstance,
  onshapeMateConnectorFeature,
  onshapeMateFeature,
  createOnshapeMate,
} from "./onshape-assemblies";
export { parseOnshapeAssemblyInstances, listOnshapeAssemblyInstances } from "./onshape-assembly-list";
export type { OnshapeAssemblyInstance } from "./onshape-assembly-list";
export * from "./onshape-features";
export * from "./onshape-update-feature";
export * from "./onshape-resolve";
export * from "./cad-tool-catalog";
export * from "./claude-cad";
export type { ClaudeCadSession, CadSessionFeature, CadSessionFeatureKind } from "./claude-session";
export {
  loadClaudeCadSession,
  saveClaudeCadSession,
  requireBoundDocument,
  recordSessionFeature,
  forgetSessionFeature,
  lastSessionFeature,
  sessionOwnsFeature,
  CAD_SESSION_FEATURE_LIMIT,
} from "./claude-session";
export * from "./onshape-url";
export * from "./cad-agent-action";
export * from "./cad-agent-steps";
export * from "./agent-modes";
export {
  runCadMcpStdio,
  dispatchCadMcp,
  callCadPartTool,
  cadMcpToolList,
  isCadPartTool,
  resetCadPartPipeline,
} from "./mcp-stdio";
export type { CadMcpHooks, CadPartRuntime } from "./mcp-stdio";
/** The Onshape annual-allowance ledger. Pure data + arithmetic; no network, no credentials. */
export * from "./call-budget";
/**
 * Offline design-for-manufacturing pass. Named rather than star-exported: `./dfm`
 * exports a `PartDefinition` (the flat DFM description) and so does
 * `./featurescript` (the buildable geometry, reached through ./onshape-features).
 * They are different types, so the DFM one is renamed here rather than being
 * silently dropped as an ambiguous star export.
 */
export {
  applyDfmCompensation,
  bedFit,
  checkPart,
  clearanceHoleMm,
  coarsePitchMm,
  compensateHoleDiameter,
  compensateHoleFeature,
  compensationIsCalibrated,
  defaultInsertIdForThread,
  describeDfmReport,
  describeModelledPart,
  extrusionWidthMm,
  findInsert,
  findMaterial,
  findPrinter,
  HEAT_SET_INSERTS,
  insertsForThread,
  isMetricThread,
  majorDiameterMm,
  MATERIAL_PROFILES,
  METRIC_THREADS,
  minimumWallMm,
  nominalHoleDiameterMm,
  optimumBossWallMm,
  PRINTER_PROFILES,
  recommendedWallMm,
  requiredBoreDepthMm,
  requiredBossWallMm,
  requireInsert,
  requireMaterial,
  requirePrinter,
  tapDrillMm,
  usableHeightMm,
  worstSeverity,
} from "./dfm";
export type {
  BedFitResult,
  CheckFinding,
  CheckId,
  CheckPartInput,
  ClearanceFit,
  CompensatedHole,
  DfmReport,
  HeatSetInsert,
  HoleKind,
  MaterialProfile,
  MetricThread,
  ModelledDimension,
  ModelledPart,
  PrinterProfile,
  Severity,
  PartDefinition as DfmPartDescription,
} from "./dfm";

export type EngineeringBrief={summary:string;requirements:string[];constraints:string[];scoringTasks:string[];assumptions:Array<{name:string;value:string;needsConfirmation:boolean}>;risks:string[];acceptanceCriteria:string[];sourceRefs:Array<{type:string;id:string;classification:string}>;disclaimer:string};
export const CAD_OPERATIONS=["create_sketch","create_extrude","create_fillet","create_chamfer","create_shell","create_pattern","set_variable","create_part_studio","create_assembly","add_assembly_instance","create_mate","create_hole","create_mirror","create_revolve","create_boolean","delete_feature","feature_script","verify_topology","render_views","create_checkpoint","rollback_checkpoint","export_step","export_stl","export_gltf"] as const;
export type CadOperation=typeof CAD_OPERATIONS[number];
export type CadAction={operation:CadOperation;parameters:Record<string,unknown>;requiresApproval:boolean;reason:string};
export type { CadExecutionResult };
export interface CadAdapter{readonly platform:"onshape"|"fusion360"|"mock";readonly executionMode:"hosted"|"local";execute(action:CadAction,context:{jobId:string;idempotencyKey:string;documentRef?:Record<string,unknown>}):Promise<CadExecutionResult>;rollback(checkpointRef:string):Promise<void>;}
export interface OnshapeTransport{mutate(input:{operation:CadOperation;parameters:Record<string,unknown>;idempotencyKey:string}):Promise<{featureId?:string;exportArtifact?:{type:string;title:string;provenance:Record<string,unknown>;previewText?:string};explain?:Record<string,unknown>}>;describe():Promise<{fingerprint:string;summary:Record<string,unknown>;render:string;checkpointRef:string}>;rollback(checkpointRef:string):Promise<void>;}
export class OnshapeHostedCadAdapter implements CadAdapter{readonly platform="onshape";readonly executionMode="hosted";constructor(private readonly transport:OnshapeTransport){}async execute(action:CadAction,context:{idempotencyKey:string}){const mutation=await this.transport.mutate({operation:action.operation,parameters:action.parameters,idempotencyKey:context.idempotencyKey}),verified=await this.transport.describe();return{externalFeatureId:mutation.featureId,output:{operation:action.operation,...(mutation.exportArtifact?{exportArtifact:mutation.exportArtifact}:{}),...(mutation.explain?{studentExplain:mutation.explain}:{})},topology:{fingerprint:verified.fingerprint,summary:verified.summary},render:{mimeType:"image/svg+xml",content:verified.render},checkpointRef:verified.checkpointRef};}rollback(checkpointRef:string){return this.transport.rollback(checkpointRef);}}
export class DeterministicMockCadAdapter implements CadAdapter{readonly platform="mock";readonly executionMode="hosted";private version=0;async execute(action:CadAction,context:{jobId:string;idempotencyKey:string}){this.version++;const fingerprint=createHash("sha256").update(`${context.jobId}:${this.version}:${action.operation}:${JSON.stringify(action.parameters)}`).digest("hex");return{externalFeatureId:`mock-feature-${this.version}`,output:{operation:action.operation,deterministic:true},topology:{fingerprint,summary:{bodies:1,features:this.version,validation:"mock-pass"}},render:{mimeType:"image/svg+xml",content:`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 450"><rect width="800" height="450" fill="#0b1115"/><path d="M180 320 L400 90 L620 320 Z" fill="none" stroke="#16d9e8" stroke-width="12"/><text x="30" y="420" fill="#dce5e8">Checkpoint ${this.version} · ${action.operation}</text></svg>`},checkpointRef:`mock-checkpoint-${this.version}`};}async rollback(){this.version=Math.max(0,this.version-1);}}
export { createMeteredCadBriefJob, planCadStrategyToolCalls };

/** Knowledge tools from the shared Assistant/CAD/Strategy graph. */
export function planCadKnowledgeToolCalls(request: string) {
  const knowledge = planCadStrategyToolCalls(request).filter((call) => call.name.startsWith("knowledge."));
  if (knowledge.length) return knowledge.slice(0, 3);
  const query = request.trim().slice(0, 200);
  return query ? [{ name: "knowledge.search", input: { query, limit: 6 } }] : [];
}

export function validateCadPlan(actions:CadAction[]){
  if(actions.length>50)throw new Error("CAD action plan exceeds the 50-step complexity limit");
  for(const action of actions){
    if(!CAD_OPERATIONS.includes(action.operation))throw new Error(`CAD operation is not allowlisted: ${action.operation}`);
    if(action.operation==="feature_script"&&String(action.parameters.source??"").length>20_000)throw new Error("FeatureScript exceeds the complexity limit");
    if(action.operation.startsWith("export_")||VERIFY_CAD_OPERATIONS.has(action.operation))continue;
    if(!action.requiresApproval)throw new Error(`Geometry mutation requires approval: ${action.operation}`);
  }
}
export class CadRepository{
 constructor(private readonly client:PoolClient){}
 async createBriefJob(input:{
   orgId:string;
   userId:string;
   threadId?:string;
   requestId:string;
   title:string;
   request:string;
   sources:ContextSource[];
   platform?:"onshape"|"fusion360"|"mock";
   executionMode?:"hosted"|"local";
   selected?:{teamKey?:string;matchKey?:string};
   seasonYear?:number;
   teamProfile?:CadTeamProfile;
   userPreferences?:Pick<CadUserPreferences,"preferredUnits">;
 }){
  // Kickoff / rules.compliance / strategy.design → CAD brief via shared agent tool graph.
  return createMeteredCadBriefJob(this.client, input);
 }
 async confirmBrief(orgId:string,jobId:string,userId:string,brief:EngineeringBrief){const result=await this.client.query(`UPDATE cad_jobs SET brief=$4::jsonb,brief_confirmed_at=now(),status='planning',updated_at=now() WHERE id=$1 AND org_id=$2 AND created_by=$3 RETURNING id`,[jobId,orgId,userId,JSON.stringify(brief)]);if(!result.rowCount)throw new Error("CAD job is unavailable");await this.audit(orgId,jobId,userId,"cad.brief.confirmed",{});}
 async savePlan(orgId:string,jobId:string,userId:string,actions:CadAction[]){validateCadPlan(actions);await this.client.query("DELETE FROM cad_job_steps WHERE job_id=$1 AND org_id=$2 AND status='planned'",[jobId,orgId]);for(const[index,action]of actions.entries())await this.client.query(`INSERT INTO cad_job_steps(org_id,job_id,sequence,operation,idempotency_key,parameters,requires_approval,approval_status) VALUES($1,$2,$3,$4,$5,$6::jsonb,$7,$8)`,[orgId,jobId,index+1,action.operation,`${jobId}:${index+1}:${createHash("sha256").update(JSON.stringify(action)).digest("hex").slice(0,16)}`,JSON.stringify({...action.parameters,reason:action.reason}),action.requiresApproval,action.requiresApproval?"pending":"approved"]);await this.client.query(`UPDATE cad_jobs SET action_plan=$3::jsonb,status='awaiting_action_approval',updated_at=now() WHERE id=$1 AND org_id=$2 AND brief_confirmed_at IS NOT NULL`,[jobId,orgId,JSON.stringify(actions)]);await this.audit(orgId,jobId,userId,"cad.plan.saved",{steps:actions.length});}
 async appendPlanStep(orgId:string,jobId:string,userId:string,action:CadAction){validateCadPlan([action]);const digest=createHash("sha256").update(`${jobId}:${Date.now()}:${JSON.stringify(action)}`).digest("hex").slice(0,20);const inserted=await this.client.query<{id:string;sequence:number}>(`WITH next_step AS (SELECT COALESCE(max(sequence),0)+1 AS sequence FROM cad_job_steps WHERE org_id=$1 AND job_id=$2) INSERT INTO cad_job_steps(org_id,job_id,sequence,operation,idempotency_key,parameters,requires_approval,approval_status) SELECT $1,$2,next_step.sequence,$3,$2||':custom:'||next_step.sequence::text||':'||$4,$5::jsonb,$6,$7 FROM next_step WHERE EXISTS(SELECT 1 FROM cad_jobs WHERE id=$2 AND org_id=$1 AND created_by=$8 AND brief_confirmed_at IS NOT NULL) RETURNING id,sequence`,[orgId,jobId,action.operation,digest,JSON.stringify({...action.parameters,reason:action.reason}),action.requiresApproval,action.requiresApproval?"pending":"approved",userId]);if(!inserted.rows[0])throw new Error("Confirm your engineering brief before adding operations");await this.client.query(`UPDATE cad_jobs SET action_plan=COALESCE(action_plan,'[]'::jsonb)||$3::jsonb,status='awaiting_action_approval',updated_at=now() WHERE id=$1 AND org_id=$2`,[jobId,orgId,JSON.stringify([action])]);await this.audit(orgId,jobId,userId,"cad.plan.step_appended",{stepId:inserted.rows[0].id,sequence:inserted.rows[0].sequence,operation:action.operation});return inserted.rows[0];}
 async approveStep(orgId:string,jobId:string,stepId:string,userId:string,approved:boolean){const result=await this.client.query(`UPDATE cad_job_steps SET approval_status=$5,approved_by=$4,approved_at=now() WHERE id=$1 AND job_id=$2 AND org_id=$3 AND status='planned' RETURNING operation`,[stepId,jobId,orgId,userId,approved?"approved":"rejected"]);if(!result.rowCount)throw new Error("CAD step is unavailable");await this.audit(orgId,jobId,userId,approved?"cad.step.approved":"cad.step.rejected",{stepId});}
 async executeStep(orgId:string,jobId:string,stepId:string,userId:string,adapter:CadAdapter){const row=(await this.client.query<{operation:CadOperation;parameters:Record<string,unknown>;idempotency_key:string;approval_status:string;brief_confirmed_at:Date|null;document_ref:Record<string,unknown>|null}>(`SELECT s.operation,s.parameters,s.idempotency_key,s.approval_status,j.brief_confirmed_at,j.document_ref FROM cad_job_steps s JOIN cad_jobs j ON j.id=s.job_id AND j.org_id=s.org_id WHERE s.id=$1 AND s.job_id=$2 AND s.org_id=$3 FOR UPDATE`,[stepId,jobId,orgId])).rows[0];if(!row||!row.brief_confirmed_at)throw new Error("Confirm the engineering brief before geometry mutation");if(row.approval_status!=="approved")throw new Error("Approve this CAD action before execution");if(!CAD_OPERATIONS.includes(row.operation))throw new Error("CAD operation is not allowlisted");
  await this.client.query(`UPDATE cad_job_steps SET status='running',started_at=now(),progress=10 WHERE id=$1`,[stepId]);const result=await adapter.execute({operation:row.operation,parameters:row.parameters,requiresApproval:true,reason:String(row.parameters.reason??"Approved action")},{jobId,idempotencyKey:row.idempotency_key,documentRef:row.document_ref??undefined});const exportArtifact=result.output.exportArtifact as{type?:string;title?:string;provenance?:Record<string,unknown>;previewText?:string}|undefined;const isExport=row.operation.startsWith("export_")&&exportArtifact?.provenance;const artifactType=isExport?String(exportArtifact!.type??`cad_${row.operation}`):"render_checkpoint";const artifactTitle=isExport?String(exportArtifact!.title??`Export: ${row.operation}`):`Checkpoint: ${row.operation}`;const artifactContent=isExport?{provenance:exportArtifact!.provenance,previewText:exportArtifact!.previewText??null,topology:result.topology,render:result.render}:{...result.render};const checksum=createHash("sha256").update(JSON.stringify(artifactContent)).digest("hex");const sourceRefs=row.document_ref?[{type:"onshape_document",id:String((row.document_ref as{documentId?:string}).documentId??"")},{type:"onshape_element",id:String((row.document_ref as{elementId?:string}).elementId??"")}]:[];const artifact=await this.client.query<{id:string}>(`INSERT INTO cad_artifacts(org_id,job_id,step_id,type,title,content,checksum,source_refs,created_by) VALUES($1,$2,$3,$4,$5,$6::jsonb,$7,$8::jsonb,$9) RETURNING id`,[orgId,jobId,stepId,artifactType,artifactTitle,JSON.stringify(artifactContent),checksum,JSON.stringify(sourceRefs),userId]);const checkpoint=await this.client.query<{id:string}>(`INSERT INTO cad_checkpoints(org_id,job_id,step_id,external_version_ref,topology_fingerprint,topology,render_artifact_id) VALUES($1,$2,$3,$4,$5,$6::jsonb,$7) RETURNING id`,[orgId,jobId,stepId,result.checkpointRef,result.topology.fingerprint,JSON.stringify(result.topology.summary),artifact.rows[0]!.id]);await this.client.query(`UPDATE cad_job_steps SET status='completed',progress=100,output=$2::jsonb,completed_at=now() WHERE id=$1`,[stepId,JSON.stringify(result.output)]);await this.client.query(`UPDATE cad_jobs SET current_checkpoint_id=$2,status='running',updated_at=now() WHERE id=$1`,[jobId,checkpoint.rows[0]!.id]);await this.audit(orgId,jobId,userId,"cad.step.executed",{stepId,operation:row.operation,checkpointId:checkpoint.rows[0]!.id,artifactType});return{...result,artifactId:artifact.rows[0]!.id,checkpointId:checkpoint.rows[0]!.id};}
 async detectHumanEdit(orgId:string,jobId:string,currentFingerprint:string){const row=(await this.client.query<{id:string;topology_fingerprint:string}>(`SELECT id,topology_fingerprint FROM cad_checkpoints WHERE job_id=$1 AND org_id=$2 ORDER BY created_at DESC LIMIT 1`,[jobId,orgId])).rows[0];if(!row)return false;const changed=row.topology_fingerprint!==currentFingerprint;if(changed)await this.client.query(`UPDATE cad_checkpoints SET human_edit_detected=true WHERE id=$1`,[row.id]);return changed;}
 private async audit(orgId:string,jobId:string,userId:string,action:string,payload:Record<string,unknown>){await this.client.query(`INSERT INTO cad_audit_events(org_id,job_id,actor_user_id,action,payload) VALUES($1,$2,$3,$4,$5::jsonb)`,[orgId,jobId,userId,action,JSON.stringify(payload)]);}
}
export function createLeaseToken(){const token=randomBytes(32).toString("base64url");return{token,hash:createHash("sha256").update(token).digest("hex")};}
