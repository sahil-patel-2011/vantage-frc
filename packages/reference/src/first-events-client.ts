import { readJson,UpstreamHttpError } from "./http";
export class FirstEventsClient{
 constructor(private readonly options:{username:string;authorizationToken:string;baseUrl?:string;fetch?:typeof fetch}){if(!options.username||!options.authorizationToken)throw new Error("FIRST Events API credentials are required");}
 async get<T>(resource:string){const base=(this.options.baseUrl??"https://frc-api.firstinspires.org/v3.0").replace(/\/$/,""),response=await(this.options.fetch??fetch)(`${base}/${resource.replace(/^\//,"")}`,{headers:{authorization:`Basic ${Buffer.from(`${this.options.username}:${this.options.authorizationToken}`).toString("base64")}`,accept:"application/json"},signal:AbortSignal.timeout(20_000)});if(!response.ok)throw new UpstreamHttpError("FIRST Events API",response.status,resource,null);return await readJson(response,"FIRST Events API",resource) as T;}
}
