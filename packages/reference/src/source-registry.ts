export type SourcePolicy={id:string;official:boolean;termsUrl:string;robotsAware:boolean;minimumIntervalMs:number;dataClass:"official"|"statistical"|"qualitative";confidence:number};
export interface RegisteredSourceAdapter<T>{policy:SourcePolicy;fetch(resource:string):Promise<{data:T;observedAt:string;sourceUrl:string}>;}
export class SourceRegistry{
 private readonly sources=new Map<string,RegisteredSourceAdapter<unknown>>();
 register<T>(adapter:RegisteredSourceAdapter<T>){if(!adapter.policy.termsUrl.startsWith("https://"))throw new Error("Source terms URL must use HTTPS");if(adapter.policy.minimumIntervalMs<0)throw new Error("Invalid source rate policy");this.sources.set(adapter.policy.id,adapter as RegisteredSourceAdapter<unknown>);return this;}
 get<T>(id:string){const source=this.sources.get(id);if(!source)throw new Error(`Source adapter is not approved: ${id}`);return source as RegisteredSourceAdapter<T>;}
 list(){return[...this.sources.values()].map(source=>source.policy);}
}
export function resolveSourceConflict<T>(official:{value:T;source:string},other:{value:T;source:string}){return{value:official.value,source:official.source,conflict:JSON.stringify(official.value)!==JSON.stringify(other.value)?{official,other}:null};}
