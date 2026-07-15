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
};

export class TbaClient {
  private readonly baseUrl: string;
  private readonly fetcher: typeof fetch;
  private readonly now: () => number;

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
