import { readJson, retryAfterMilliseconds, UpstreamHttpError } from "./http";

export type StatboticsClientOptions = {
  baseUrl?: string;
  fetch?: typeof fetch;
  userAgent?: string;
  minimumIntervalMs?: number;
  maximumAttempts?: number;
  baseBackoffMs?: number;
  sleep?: (milliseconds: number) => Promise<void>;
  now?: () => number;
  random?: () => number;
};

const defaultSleep = (milliseconds: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, milliseconds));

export class StatboticsClient {
  private readonly baseUrl: string;
  private readonly fetcher: typeof fetch;
  private readonly sleep: (milliseconds: number) => Promise<void>;
  private readonly now: () => number;
  private readonly random: () => number;
  private nextRequestAt = 0;

  constructor(private readonly options: StatboticsClientOptions = {}) {
    this.baseUrl = (options.baseUrl ?? "https://api.statbotics.io/v3").replace(
      /\/$/,
      "",
    );
    this.fetcher = options.fetch ?? fetch;
    this.sleep = options.sleep ?? defaultSleep;
    this.now = options.now ?? Date.now;
    this.random = options.random ?? Math.random;
  }

  async get<T>(resource: string): Promise<T> {
    const attempts = Math.max(1, this.options.maximumAttempts ?? 4);
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      await this.throttle();
      const response = await this.fetcher(
        `${this.baseUrl}/${resource.replace(/^\//, "")}`,
        {
          headers: {
            Accept: "application/json",
            "User-Agent":
              this.options.userAgent ?? "Vantage-Reference-Ingest/1.0",
          },
          signal: AbortSignal.timeout(20_000),
        },
      );
      if (response.ok)
        return (await readJson(response, "Statbotics", resource)) as T;

      const retryable = response.status === 429 || response.status >= 500;
      const retryAfter = retryAfterMilliseconds(
        response.headers.get("retry-after"),
        this.now,
      );
      if (!retryable || attempt === attempts - 1) {
        throw new UpstreamHttpError(
          "Statbotics",
          response.status,
          resource,
          retryAfter,
        );
      }
      const exponential = (this.options.baseBackoffMs ?? 500) * 2 ** attempt;
      const jitter = Math.floor(exponential * 0.2 * this.random());
      await this.sleep(retryAfter ?? exponential + jitter);
    }
    throw new Error("Unreachable Statbotics retry state");
  }

  private async throttle(): Promise<void> {
    const interval = Math.max(0, this.options.minimumIntervalMs ?? 350);
    const current = this.now();
    const wait = Math.max(0, this.nextRequestAt - current);
    this.nextRequestAt = Math.max(current, this.nextRequestAt) + interval;
    if (wait > 0) await this.sleep(wait);
  }
}
