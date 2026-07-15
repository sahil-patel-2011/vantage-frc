import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { createHmac,randomBytes,timingSafeEqual } from "node:crypto";

function blockedIp(address: string) {
  if (address === "::1" || address === "0.0.0.0") return true;
  if (address.includes(":")) return address.toLowerCase().startsWith("fc") || address.toLowerCase().startsWith("fd") || address.toLowerCase().startsWith("fe80");
  const [a = 0, b = 0] = address.split(".").map(Number);
  return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127);
}

export async function validateHostedProviderUrl(value: string) {
  const url = new URL(value);
  if (url.protocol !== "https:") throw new Error("Hosted provider URLs must use HTTPS");
  if (url.username || url.password) throw new Error("Credentials must not be embedded in provider URLs");
  if (url.hostname === "localhost" || url.hostname.endsWith(".local"))
    throw new Error("Local providers require the Vantage local relay");
  const addresses = isIP(url.hostname)
    ? [{ address: url.hostname }]
    : await lookup(url.hostname, { all: true, verbatim: true });
  if (!addresses.length || addresses.some(({ address }) => blockedIp(address)))
    throw new Error("Private, metadata, and local-network provider targets are blocked");
  return url.toString().replace(/\/$/, "");
}

export type LocalRelayRequest = {
  jobId: string;
  operation: "invoke_llm";
  model: string;
  messages: Array<{ role: "system" | "user" | "assistant"; content: string }>;
  maxTokens: number;
};
export type LocalRelayResponse = {
  jobId: string;
  content: string;
  promptTokens: number;
  completionTokens: number;
  providerModel: string;
};

export interface Base44Transport {
  invoke(config: { bridgeUrl: string; appId: string; signingSecret: string; timeoutMs:number }, payload: Base44BridgeRequest): Promise<{
    content: string;
    promptTokens?: number;
    completionTokens?: number;
    providerModel?: string;
    usage?:Record<string,unknown>;
    status?:number;
    errorCode?:string;
  }>;
}
export type Base44BridgeRequest={requestId:string;orgId:string;userId:string;feature:"strategy"|"team_intel"|"research"|"prediction"|"cad"|"coding"|"maintenance"|"chat";modelDisplay:string;messages:Array<{role:"system"|"user"|"assistant";content:string}>;maxTokens:number;nonce:string;issuedAt:string};
export class Base44CreditExhaustedError extends Error{constructor(){super("Base44 workspace integration credits are exhausted");this.name="Base44CreditExhaustedError";}}
export function signBase44BridgeRequest(payload:Base44BridgeRequest,secret:string){return createHmac("sha256",secret).update(JSON.stringify(payload)).digest("base64url");}
export function verifyBase44BridgeSignature(payload:Base44BridgeRequest,signature:string,secret:string,now=Date.now()){const expected=signBase44BridgeRequest(payload,secret),a=Buffer.from(signature),b=Buffer.from(expected);return a.length===b.length&&timingSafeEqual(a,b)&&Math.abs(now-Date.parse(payload.issuedAt))<=60_000;}
export class Base44NonceGuard{private readonly seen=new Map<string,number>();consume(nonce:string,expiresAt:number,now=Date.now()){for(const[item,expiry]of this.seen)if(expiry<=now)this.seen.delete(item);if(this.seen.has(nonce)||expiresAt<=now)return false;this.seen.set(nonce,expiresAt);return true;}}

export class Base44WorkspaceConnector {
  constructor(
    private readonly config: {
      endpoint?: string;
      workspaceId?: string;
      credential?: string;
      enabled: boolean;
      meteringMode: "verified" | "unverified";
      appId?:string;bridgeUrl?:string;signingSecret?:string;featureFlagEnabled?:boolean;
      approvalReference?:string;approvalDate?:string;approvalAcknowledged?:boolean;healthVerified?:boolean;
      modelMappings?:Record<string,string>;dailyQuota?:number;timeoutMs?:number;
    },
    private readonly transport?: Base44Transport,
  ) {}
  async invoke(input:Omit<Base44BridgeRequest,"nonce"|"issuedAt">) {
    if (!this.config.enabled || !this.config.featureFlagEnabled)
      throw new Error("Base44 production routing is disabled by default");
    if(!this.config.approvalAcknowledged||!this.config.approvalReference||!this.config.approvalDate)
      throw new Error("Written Base44/OEM approval acknowledgement is required");
    if(!this.config.healthVerified)throw new Error("Base44 bridge health test must pass before enablement");
    if(!this.config.appId||!this.config.bridgeUrl||!this.config.signingSecret)throw new Error("Base44 app ID, function bridge URL, and shared signing secret are required");
    const mapped=this.config.modelMappings?.[input.modelDisplay];if(!mapped)throw new Error("No documented Base44 model mapping is configured");
    if (!this.transport) throw new Error("No documented Base44 transport is configured");
    const payload:Base44BridgeRequest={...input,modelDisplay:mapped,nonce:randomBytes(16).toString("base64url"),issuedAt:new Date().toISOString()};
    const result = await this.transport.invoke(
      {
        bridgeUrl: await validateHostedProviderUrl(this.config.bridgeUrl),
        appId:this.config.appId,signingSecret:this.config.signingSecret,timeoutMs:this.config.timeoutMs??20_000,
      },
      payload,
    );
    if(result.status===402||result.errorCode==="credits_exhausted")throw new Base44CreditExhaustedError();
    if(result.status===429)throw new Error("Base44 bridge rate limited the request; retry with backoff");
    return result;
  }
}
export class HttpBase44BridgeTransport implements Base44Transport{async invoke(config:{bridgeUrl:string;appId:string;signingSecret:string;timeoutMs:number},payload:Base44BridgeRequest){const signature=signBase44BridgeRequest(payload,config.signingSecret),response=await fetch(config.bridgeUrl,{method:"POST",headers:{"content-type":"application/json","x-vantage-app-id":config.appId,"x-vantage-signature":signature,"x-vantage-nonce":payload.nonce},body:JSON.stringify(payload),signal:AbortSignal.timeout(config.timeoutMs)}),data=await response.json() as Record<string,unknown>;return{content:String(data.content??""),promptTokens:typeof data.promptTokens==="number"?data.promptTokens:undefined,completionTokens:typeof data.completionTokens==="number"?data.completionTokens:undefined,providerModel:typeof data.providerModel==="string"?data.providerModel:undefined,usage:data.usage&&typeof data.usage==="object"?data.usage as Record<string,unknown>:undefined,status:response.status,errorCode:typeof data.errorCode==="string"?data.errorCode:undefined};}}

export type LocalCliSelection={
  connector:"claude-code";
  requestingUserId:string;
  orgId:string;
  platformAdmin:boolean;
  pairedDeviceUserId:string;
  pairedDeviceOrgId:string;
  privacyScope:"private"|"team";
  interactive:boolean;
  backgroundJob:boolean;
  explicitOptIn:boolean;
};
export function authorizeLocalCliConnector(input:LocalCliSelection){
  if(input.connector!=="claude-code")throw new Error("Local CLI connector is not allowlisted");
  if(!input.platformAdmin||input.requestingUserId!==input.pairedDeviceUserId||input.orgId!==input.pairedDeviceOrgId)throw new Error("Claude Code local connector is restricted to the platform owner's matching paired device");
  if(input.privacyScope!=="private"||!input.interactive||input.backgroundJob)throw new Error("Claude Code local connector is personal local use only and cannot service team or background requests");
  if(!input.explicitOptIn)throw new Error("Explicit local CLI opt-in is required");
  return{allowed:true as const,billingSource:"personal-local-cli" as const,label:"Personal local use only"};
}
