/**
 * In-process counters for one Pi layer. Device totals only — never org ids.
 * Isolation stays in what Vantage sends; this box only knows how busy it is.
 */

export const TELEMETRY_WINDOW_MS = 60_000;
export const DEFAULT_MAX_CONCURRENT = 16;

export type FeatureInFlight = Record<string, number>;

export type DeviceTelemetrySnapshot = {
  day: string;
  tokensIn: number;
  tokensOut: number;
  tokensOutPerSec: number;
  activeRequests: number;
  maxConcurrent: number;
  available: number;
  byFeature: FeatureInFlight;
};

export function utcDayKey(atMs: number = Date.now()): string {
  return new Date(atMs).toISOString().slice(0, 10);
}

export function estimateTokensFromText(text: string): number {
  const trimmed = text.trim();
  if (!trimmed) return 0;
  return Math.max(1, Math.ceil(trimmed.length / 4));
}

export function sanitizeFeatureLabel(raw: string | null | undefined): string {
  const cleaned = String(raw ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "")
    .slice(0, 48);
  return cleaned || "chat";
}

export function readUsageFromCompletionBody(body: string): { prompt: number; completion: number } | null {
  try {
    const parsed = JSON.parse(body) as { usage?: { prompt_tokens?: unknown; completion_tokens?: unknown } };
    const usage = parsed?.usage;
    if (!usage) return null;
    const prompt = Number(usage.prompt_tokens ?? 0);
    const completion = Number(usage.completion_tokens ?? 0);
    if (!Number.isFinite(prompt) || !Number.isFinite(completion) || prompt < 0 || completion < 0) {
      return null;
    }
    return { prompt: Math.floor(prompt), completion: Math.floor(completion) };
  } catch {
    return null;
  }
}

/** Pull a usage object out of an SSE stream if the proxy sent one. */
export function readUsageFromSse(buffer: string): { prompt: number; completion: number } | null {
  const matches = buffer.match(/"usage"\s*:\s*\{[^}]+\}/g);
  if (!matches?.length) return null;
  for (let i = matches.length - 1; i >= 0; i -= 1) {
    try {
      const parsed = JSON.parse(`{${matches[i]}}`) as {
        usage?: { prompt_tokens?: unknown; completion_tokens?: unknown };
      };
      const usage = parsed.usage;
      if (!usage) continue;
      const prompt = Number(usage.prompt_tokens ?? 0);
      const completion = Number(usage.completion_tokens ?? 0);
      if (Number.isFinite(prompt) && Number.isFinite(completion) && prompt >= 0 && completion >= 0) {
        return { prompt: Math.floor(prompt), completion: Math.floor(completion) };
      }
    } catch {
      // keep looking
    }
  }
  return null;
}

export function averageOutTokensPerSec(
  events: ReadonlyArray<{ atMs: number; tokens: number }>,
  nowMs: number,
  windowMs = TELEMETRY_WINDOW_MS,
): number {
  const start = nowMs - windowMs;
  let tokens = 0;
  for (const event of events) {
    if (event.atMs >= start && event.tokens > 0) tokens += event.tokens;
  }
  return tokens / (windowMs / 1000);
}

export class PiDeviceTelemetry {
  inFlight = 0;
  private day = utcDayKey();
  private tokensIn = 0;
  private tokensOut = 0;
  private readonly outEvents: Array<{ atMs: number; tokens: number }> = [];
  private readonly features = new Map<string, number>();

  constructor(
    readonly maxConcurrent: number = DEFAULT_MAX_CONCURRENT,
    private readonly now: () => number = Date.now,
  ) {}

  get available(): number {
    return Math.max(0, this.maxConcurrent - this.inFlight);
  }

  tryBegin(feature: string): boolean {
    if (this.inFlight >= this.maxConcurrent) return false;
    this.inFlight += 1;
    const key = sanitizeFeatureLabel(feature);
    this.features.set(key, (this.features.get(key) ?? 0) + 1);
    return true;
  }

  end(feature: string): void {
    this.inFlight = Math.max(0, this.inFlight - 1);
    const key = sanitizeFeatureLabel(feature);
    const next = (this.features.get(key) ?? 1) - 1;
    if (next <= 0) this.features.delete(key);
    else this.features.set(key, next);
  }

  record(promptTokens: number, completionTokens: number): void {
    this.rollDay();
    const prompt = Math.max(0, Math.floor(promptTokens));
    const completion = Math.max(0, Math.floor(completionTokens));
    this.tokensIn += prompt;
    this.tokensOut += completion;
    if (completion > 0) this.outEvents.push({ atMs: this.now(), tokens: completion });
    this.prune();
  }

  snapshot(): DeviceTelemetrySnapshot {
    this.rollDay();
    const byFeature: FeatureInFlight = {};
    for (const [feature, count] of this.features) byFeature[feature] = count;
    return {
      day: this.day,
      tokensIn: this.tokensIn,
      tokensOut: this.tokensOut,
      tokensOutPerSec: Number(averageOutTokensPerSec(this.outEvents, this.now()).toFixed(2)),
      activeRequests: this.inFlight,
      maxConcurrent: this.maxConcurrent,
      available: this.available,
      byFeature,
    };
  }

  private rollDay(): void {
    const today = utcDayKey(this.now());
    if (today === this.day) return;
    this.day = today;
    this.tokensIn = 0;
    this.tokensOut = 0;
    this.outEvents.length = 0;
  }

  private prune(): void {
    const cutoff = this.now() - TELEMETRY_WINDOW_MS;
    while (this.outEvents.length && this.outEvents[0]!.atMs < cutoff) this.outEvents.shift();
  }
}
