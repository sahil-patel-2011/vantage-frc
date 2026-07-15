import type { PoolClient } from "@neondatabase/serverless";
import { meteredAI } from "@vantage/billing";
import { boundedContext,type ChatAdapter,type ContextItem } from "./index";

export type ClaimClassification="hard_metric"|"scout_observation"|"researched_claim"|"model_inference";
export type ContextSource=ContextItem&{classification:ClaimClassification|"private_memory"|"team_memory"|"artifact";sourceUrl?:string;observedAt?:string};
export type ToolExecutionContext={client:PoolClient;orgId:string;userId:string;activeEventKey:string|null};
export type ToolDefinition<I,O>={name:string;description:string;parseInput(value:unknown):I;parseOutput(value:unknown):O;execute(context:ToolExecutionContext,input:I):Promise<O>};

export class AIToolRegistry{
  private readonly tools=new Map<string,ToolDefinition<unknown,unknown>>();
  register<I,O>(tool:ToolDefinition<I,O>){if(this.tools.has(tool.name))throw new Error(`AI tool already registered: ${tool.name}`);this.tools.set(tool.name,tool as ToolDefinition<unknown,unknown>);return this;}
  async invoke(name:string,context:ToolExecutionContext,input:unknown){const tool=this.tools.get(name);if(!tool)throw new Error(`AI tool is not authorized: ${name}`);const parsed=tool.parseInput(input);return tool.parseOutput(await tool.execute(context,parsed));}
  list(){return[...this.tools.values()].map(({name,description})=>({name,description}));}
}

export function buildUnifiedContext(sources:ContextSource[],tokenBudget:number){
  const unique=[...new Map(sources.map(item=>[`${item.type}:${item.id}`,item])).values()];
  const bounded=boundedContext(unique,tokenBudget);
  return{...bounded,items:bounded.items as ContextSource[],provenance:bounded.items.map(item=>{const source=item as ContextSource;return{type:source.type,id:source.id,classification:source.classification,sourceUrl:source.sourceUrl,observedAt:source.observedAt};})};
}

export type OrchestratorRequest={
  orgId:string;userId:string;threadId?:string;requestId:string;capability:"strategy"|"team_intel"|"research"|"prediction"|"cad"|"coding"|"maintenance"|"chat";
  privacyScope:"private"|"team";message:string;adapter:ChatAdapter;contextSources:ContextSource[];tokenBudget?:number;
  selected?:{teamKey?:string;matchKey?:string};toolCalls?:Array<{name:string;input:unknown}>;
  billingOwner?:{type:"user"|"org";id:string};usesOrgData?:boolean;
};
export class AIOrchestrator{
  constructor(private readonly client:PoolClient,private readonly registry=new AIToolRegistry()){}
  async run(request:OrchestratorRequest){
    const active=(await this.client.query<{active_event_key:string|null}>(`SELECT active_event_key FROM org_active_context WHERE org_id=$1`,[request.orgId])).rows[0]?.active_event_key??null;
    let billingOwner=request.billingOwner;if(!billingOwner&&request.privacyScope==="private"){const personal=await this.client.query(`SELECT 1 FROM billing_accounts a JOIN billing_subscriptions s ON s.billing_account_id=a.id AND s.status IN ('active','trialing') WHERE a.owner_user_id=$1 AND s.current_period_start<=now() AND s.current_period_end>now()`,[request.userId]);if(personal.rowCount)billingOwner={type:"user",id:request.userId};}billingOwner??={type:"org",id:request.orgId};
    const usesOrgData=request.usesOrgData??request.contextSources.some(source=>["team_memory","hard_metric","scout_observation","researched_claim","artifact"].includes(source.classification));if(billingOwner.type==="user"&&usesOrgData){const allowed=await this.client.query(`SELECT 1 FROM org_member_funding_policies WHERE org_id=$1 AND user_id=$2 AND allow_individual_funding=true`,[request.orgId,request.userId]);if(!allowed.rowCount)throw new Error("Organization admin approval is required to fund an org-data run with an individual plan");}
    if(request.privacyScope==="team"&&billingOwner.type!=="org")throw new Error("Team-shared AI must use the organization billing account");
    const run=await this.client.query<{id:string}>(`INSERT INTO ai_runs(org_id,user_id,thread_id,capability,privacy_scope,request_id,input,billing_owner_type,billing_owner_id) VALUES($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9) RETURNING id`,[request.orgId,request.userId,request.threadId??null,request.capability,request.privacyScope,request.requestId,JSON.stringify({message:request.message,activeEventKey:active,selected:request.selected??{}}),billingOwner.type,billingOwner.id]);
    const runId=run.rows[0]!.id;let sequence=0;
    try{
      const context=buildUnifiedContext(request.contextSources,request.tokenBudget??4000);
      await this.client.query(`INSERT INTO ai_run_steps(org_id,run_id,sequence,kind,input,output,provenance) VALUES($1,$2,$3,'context',$4::jsonb,$5::jsonb,$6::jsonb)`,[request.orgId,runId,sequence++,JSON.stringify({tokenBudget:request.tokenBudget??4000}),JSON.stringify({estimatedTokens:context.estimatedTokens}),JSON.stringify(context.provenance)]);
      const toolOutputs:Array<{name:string;output:unknown}>=[];
      for(const call of request.toolCalls??[]){const output=await this.registry.invoke(call.name,{client:this.client,orgId:request.orgId,userId:request.userId,activeEventKey:active},call.input);toolOutputs.push({name:call.name,output});await this.client.query(`INSERT INTO ai_run_steps(org_id,run_id,sequence,kind,tool_name,input,output) VALUES($1,$2,$3,'tool',$4,$5::jsonb,$6::jsonb)`,[request.orgId,runId,sequence++,call.name,JSON.stringify(call.input),JSON.stringify(output)]);}
      const toolContext:ContextItem[]=toolOutputs.map((item,index)=>({type:"module_fact",id:`${item.name}:${index}`,content:JSON.stringify(item.output),importance:1}));
      const text=await meteredAI({client:this.client,orgId:request.orgId,userId:request.userId,feature:request.capability,requestId:request.requestId,estimatedCostUsd:.01,estimatedPromptTokens:Math.ceil(request.message.length/4)+context.estimatedTokens+toolContext.reduce((sum,item)=>sum+Math.ceil(item.content.length/4),0),estimatedCompletionTokens:700,provider:request.adapter.provider,model:request.adapter.model,billingOwner,metadata:{runId,threadId:request.threadId,activeEventKey:active,contextSources:context.provenance},invoke:async()=>{const result=await request.adapter.complete({message:request.message,context:[...context.items,...toolContext]});return{value:result.text,...result,provider:request.adapter.provider,model:request.adapter.model};}});
      const usage=(await this.client.query<{id:string;cost_usd:string;key_source:string}>(`SELECT id,cost_usd,key_source FROM ai_usage_events WHERE request_id=$1`,[request.requestId])).rows[0];const credit=(await this.client.query<{credits:string;bucket:string}>(`SELECT credits,bucket FROM credit_ledger WHERE reference_id=$1 ORDER BY created_at DESC LIMIT 1`,[request.requestId])).rows[0];
      await this.client.query(`UPDATE ai_runs SET status='completed',provider=$2,model=$3,output=$4::jsonb,context_sources=$5::jsonb,usage_event_id=$6,provider_cost_usd=$7,credit_debit=$8,allowance_bucket=$9,routing_decision=$10::jsonb,completed_at=now() WHERE id=$1`,[runId,request.adapter.provider,request.adapter.model,JSON.stringify({text}),JSON.stringify(context.provenance),usage?.id??null,usage?.cost_usd??null,credit?Math.abs(Number(credit.credits)):0,credit?.bucket??usage?.key_source??null,JSON.stringify({provider:request.adapter.provider,model:request.adapter.model,billingOwner})]);
      await this.client.query(`INSERT INTO ai_run_steps(org_id,run_id,sequence,kind,output,provenance) VALUES($1,$2,$3,'generation',$4::jsonb,$5::jsonb)`,[request.orgId,runId,sequence,JSON.stringify({text}),JSON.stringify(context.provenance)]);
      return{runId,text,contextSources:context.provenance,provider:request.adapter.provider,model:request.adapter.model};
    }catch(error){await this.client.query(`UPDATE ai_runs SET status='failed',error=$2,completed_at=now() WHERE id=$1`,[runId,error instanceof Error?error.message:"AI run failed"]);throw error;}
  }
  async createArtifact(input:{runId:string;orgId:string;userId:string;threadId?:string;kind:string;title:string;content:Record<string,unknown>;parentArtifactId?:string;claims?:Array<{claim:string;classification:ClaimClassification;sourceIds:string[]}>}){
    let version=1;if(input.parentArtifactId){const previous=await this.client.query<{version:number}>(`SELECT version FROM ai_artifacts WHERE id=$1 AND org_id=$2`,[input.parentArtifactId,input.orgId]);if(!previous.rows[0])throw new Error("Parent artifact is not available in this organization");version=previous.rows[0].version+1;}
    const artifact=await this.client.query<{id:string}>(`INSERT INTO ai_artifacts(org_id,run_id,thread_id,parent_artifact_id,created_by,kind,title,version,content,claim_provenance) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10::jsonb) RETURNING id`,[input.orgId,input.runId,input.threadId??null,input.parentArtifactId??null,input.userId,input.kind,input.title,version,JSON.stringify(input.content),JSON.stringify(input.claims??[])]);
    if(input.parentArtifactId)await this.client.query(`INSERT INTO artifact_links(org_id,from_artifact_id,to_artifact_id,relation) VALUES($1,$2,$3,'version_of')`,[input.orgId,artifact.rows[0]!.id,input.parentArtifactId]);return{id:artifact.rows[0]!.id,version};
  }
}
