import { readJson, retryAfterMilliseconds, UpstreamHttpError } from "./http";

export type TbaResponse<T> =
  | {
      status: 304;
      data: null;
      etag: string | null;
      lastModified: string | null;
    }
  | { status: 200; data: T; etag: string | null; lastModified: string | null };

export type TbaRequestOptions = {
  etag?: string | null;
  lastModified?: string | null;
};

export type TbaClientOptions = {
  authKey: string;
  baseUrl?: string;
  fetch?: typeof fetch;
  userAgent?: string;
  now?: () => number;
  concurrency?: number;
  maxRetries?: number;
  random?: () => number;
};

export class TbaClient {
  private readonly baseUrl: string;
  private readonly fetcher: typeof fetch;
  private readonly now: () => number;
  private readonly inFlight=new Map<string,Promise<TbaResponse<unknown>>>();
  private active=0;
  private readonly waiters:Array<()=>void>=[];

  constructor(private readonly options: TbaClientOptions) {
    if (!options.authKey.trim()) throw new Error("TBA auth key is required");
    this.baseUrl = (
      options.baseUrl ?? "https://www.thebluealliance.com/api/v3"
    ).replace(/\/$/, "");
    this.fetcher = options.fetch ?? fetch;
    this.now = options.now ?? Date.now;
  }

  async get<T>(
    resource: string,
    options: TbaRequestOptions = {},
  ): Promise<TbaResponse<T>> {
    const key=`${resource}:${options.etag??""}:${options.lastModified??""}`;
    const existing=this.inFlight.get(key);if(existing)return existing as Promise<TbaResponse<T>>;
    const promise=this.getWithRetry<T>(resource,options);this.inFlight.set(key,promise as Promise<TbaResponse<unknown>>);
    try{return await promise;}finally{this.inFlight.delete(key);}
  }
  private async acquire(){const limit=this.options.concurrency??4;if(this.active>=limit)await new Promise<void>(resolve=>this.waiters.push(resolve));this.active++;}
  private release(){this.active--;this.waiters.shift()?.();}
  private async getWithRetry<T>(resource:string,options:TbaRequestOptions):Promise<TbaResponse<T>>{
    const attempts=this.options.maxRetries??3;for(let attempt=0;;attempt++){try{await this.acquire();try{return await this.request<T>(resource,options);}finally{this.release();}}catch(error){const retryable=error instanceof UpstreamHttpError&&(error.status===429||error.status>=500);if(!retryable||attempt>=attempts)throw error;const base=error.retryAfterMs??Math.min(30_000,500*2**attempt);const jitter=Math.floor(base*.25*(this.options.random?.()??Math.random()));await new Promise(resolve=>setTimeout(resolve,base+jitter));}}
  }
  private async request<T>(resource:string,options:TbaRequestOptions):Promise<TbaResponse<T>>{
    const headers = new Headers({
      "X-TBA-Auth-Key": this.options.authKey,
      Accept: "application/json",
      "User-Agent": this.options.userAgent ?? "Vantage-Reference-Ingest/1.0",
    });
    if (options.etag) headers.set("If-None-Match", options.etag);
    if (options.lastModified)
      headers.set("If-Modified-Since", options.lastModified);

    const response = await this.fetcher(
      `${this.baseUrl}/${resource.replace(/^\//, "")}`,
      {
        headers,
        signal: AbortSignal.timeout(20_000),
      },
    );
    const etag = response.headers.get("etag");
    const lastModified = response.headers.get("last-modified");
    if (response.status === 304)
      return { status: 304, data: null, etag, lastModified };
    if (!response.ok) {
      throw new UpstreamHttpError(
        "TBA",
        response.status,
        resource,
        retryAfterMilliseconds(response.headers.get("retry-after"), this.now),
      );
    }
    return {
      status: 200,
      data: (await readJson(response, "TBA", resource)) as T,
      etag,
      lastModified,
    };
  }
}
