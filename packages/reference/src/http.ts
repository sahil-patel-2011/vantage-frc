export class UpstreamHttpError extends Error {
  constructor(
    readonly source: string,
    readonly status: number,
    readonly resource: string,
    readonly retryAfterMs: number | null,
    message = `${source} request failed with HTTP ${status}`,
  ) {
    super(message);
    this.name = "UpstreamHttpError";
  }
}

export function retryAfterMilliseconds(
  value: string | null,
  now: () => number,
): number | null {
  if (!value) return null;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1_000);
  const date = Date.parse(value);
  return Number.isNaN(date) ? null : Math.max(0, date - now());
}

export async function readJson(
  response: Response,
  source: string,
  resource: string,
): Promise<unknown> {
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().includes("application/json")) {
    throw new UpstreamHttpError(
      source,
      response.status,
      resource,
      null,
      `${source} returned non-JSON content for ${resource}`,
    );
  }
  try {
    return await response.json();
  } catch (error) {
    throw new UpstreamHttpError(
      source,
      response.status,
      resource,
      null,
      `${source} returned invalid JSON for ${resource}: ${error instanceof Error ? error.message : "unknown error"}`,
    );
  }
}
