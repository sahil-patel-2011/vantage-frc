/**
 * In-process counters for one Pi layer. Device totals only — never org ids.
 * Isolation stays in what Vantage sends; this box only knows how busy it is.
 */

export const TELEMETRY_WINDOW_MS = 60_000;
export const DEFAULT_MAX_CONCURRENT = 16;

/** Jobs that can occupy a slot for hours. Most slots stay free for short chat. */
export const LONG_RUNNING_FEATURES = new Set([
  "deep_game_analysis",
  "memory_dream",
  "overnight_intel",
  "team_dream",
  "team_dream_week",
]);

export type SlotDecision = "ok" | "full" | "long_cap";

export function longSlotCap(maxConcurrent: number): number {
  return Math.max(1, Math.floor(maxConcurrent / 4));
}

/**
 * Short-chat seats held for the default-fast team (6925). Tiny boxes keep every
 * seat shared so a 2-slot test/dev layer does not lock out everyone else.
 */
export function prioritySlotCap(maxConcurrent: number): number {
  if (maxConcurrent <= 2) return 0;
  return Math.min(Math.max(2, Math.floor(maxConcurrent / 8)), Math.floor(maxConcurrent / 4));
}

export type SlotBeginOptions = {
  /** Team 6925 short chats. Long jobs never take these reserved seats. */
  priority?: boolean;
};

export function isLongRunningFeature(feature: string): boolean {
  return LONG_RUNNING_FEATURES.has(sanitizeFeatureLabel(feature));
}

export type FeatureInFlight = Record<string, number>;

export type DeviceTelemetrySnapshot = {
  day: string;
  tokensIn: number;
  tokensOut: number;
  tokensOutPerSec: number;
  activeRequests: number;
  maxConcurrent: number;
  available: number;
  longInFlight: number;
  longSlotCap: number;
  prioritySlotCap: number;
  priorityReservedInFlight: number;
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
  private priorityReservedInFlight = 0;
  private readonly outEvents: Array<{ atMs: number; tokens: number }> = [];
  private readonly features = new Map<string, number>();

  constructor(
    readonly maxConcurrent: number = DEFAULT_MAX_CONCURRENT,
    private readonly now: () => number = Date.now,
  ) {}

  get available(): number {
    return Math.max(0, this.maxConcurrent - this.inFlight);
  }

  longInFlight(): number {
    let count = 0;
    for (const [feature, n] of this.features) {
      if (LONG_RUNNING_FEATURES.has(feature)) count += n;
    }
    return count;
  }

  private generalInFlight(): number {
    return Math.max(0, this.inFlight - this.priorityReservedInFlight);
  }

  canBegin(feature: string, options: SlotBeginOptions = {}): SlotDecision {
    const long = isLongRunningFeature(feature);
    if (long && this.longInFlight() >= longSlotCap(this.maxConcurrent)) {
      return "long_cap";
    }
    if (this.inFlight >= this.maxConcurrent) return "full";
    const reserved = prioritySlotCap(this.maxConcurrent);
    const generalCap = this.maxConcurrent - reserved;
    const priorityShort = options.priority === true && !long;
    if (priorityShort) {
      if (this.priorityReservedInFlight < reserved) return "ok";
      return this.generalInFlight() < generalCap ? "ok" : "full";
    }
    return this.generalInFlight() < generalCap ? "ok" : "full";
  }

  beginSlot(
    feature: string,
    options: SlotBeginOptions = {},
  ): { ok: boolean; reserved: boolean } {
    if (this.canBegin(feature, options) !== "ok") return { ok: false, reserved: false };
    const key = sanitizeFeatureLabel(feature);
    const long = isLongRunningFeature(key);
    const reservedCap = prioritySlotCap(this.maxConcurrent);
    const reserved =
      options.priority === true && !long && this.priorityReservedInFlight < reservedCap;
    this.inFlight += 1;
    this.features.set(key, (this.features.get(key) ?? 0) + 1);
    if (reserved) this.priorityReservedInFlight += 1;
    return { ok: true, reserved };
  }

  tryBegin(feature: string, options: SlotBeginOptions = {}): boolean {
    return this.beginSlot(feature, options).ok;
  }

  end(feature: string, reserved = false): void {
    this.inFlight = Math.max(0, this.inFlight - 1);
    const key = sanitizeFeatureLabel(feature);
    const next = (this.features.get(key) ?? 1) - 1;
    if (next <= 0) this.features.delete(key);
    else this.features.set(key, next);
    if (reserved) this.priorityReservedInFlight = Math.max(0, this.priorityReservedInFlight - 1);
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
      longInFlight: this.longInFlight(),
      longSlotCap: longSlotCap(this.maxConcurrent),
      prioritySlotCap: prioritySlotCap(this.maxConcurrent),
      priorityReservedInFlight: this.priorityReservedInFlight,
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
