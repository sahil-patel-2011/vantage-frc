import { TbaClient,type TbaRequestOptions,type TbaResponse } from "./tba-client";
import { UpstreamHttpError } from "./http";
export type TbaCredential={opaqueId:string;secret:string;scope:"platform"|"org";orgId?:string};
export interface TbaCredentialStore{platform():Promise<TbaCredential|null>;fallbackForOrgs(orgIds:string[]):Promise<TbaCredential[]>;recordHealth(input:{status:"healthy"|"degraded"|"unavailable";opaqueId?:string;httpStatus?:number;error?:string;nextAttemptAt?:Date}):Promise<void>;}
export class GlobalTbaCoordinator{
 constructor(private readonly credentials:TbaCredentialStore,private readonly options:{baseUrl?:string;fetch?:typeof fetch;now?:()=>number}={}){}
 async get<T>(resource:string,conditional:TbaRequestOptions={},fallbackOrgIds:string[]=[]):Promise<TbaResponse<T>>{
  const platform=await this.credentials.platform();const fallbacks=await this.credentials.fallbackForOrgs(fallbackOrgIds);const candidates=[...(platform?[platform]:[]),...fallbacks];if(!candidates.length)throw new Error("TBA Read API key is not configured");
  let last:unknown;for(const credential of candidates){try{const response=await new TbaClient({authKey:credential.secret,baseUrl:this.options.baseUrl,fetch:this.options.fetch,now:this.options.now}).get<T>(resource,conditional);await this.credentials.recordHealth({status:"healthy",opaqueId:credential.opaqueId,httpStatus:response.status});return response;}catch(error){last=error;const status=error instanceof UpstreamHttpError?error.status:undefined;await this.credentials.recordHealth({status:"degraded",opaqueId:credential.opaqueId,httpStatus:status,error:error instanceof Error?error.message:"TBA request failed"});if(!(status===401||status===403||status===429||status===503))break;}}
  await this.credentials.recordHealth({status:"unavailable",error:last instanceof Error?last.message:"TBA unavailable"});throw last;
 }
}
export function tbaPollingInterval(input:{eventActive:boolean;eventWithinDays:number|null;sourceHealthy:boolean}){if(!input.sourceHealthy)return 5*60_000;if(input.eventActive)return 30_000;if(input.eventWithinDays!==null&&Math.abs(input.eventWithinDays)<=1)return 2*60_000;return 6*60*60_000;}
