/** Match-relative observations. Counts measure released fuel, never inferred game points. */
export const MATCH_CAPTURE_KEY = "_match_capture";
export const CAPTURE_KINDS = ["shooting", "feeding", "defending", "disabled"] as const;
export type CaptureKind = (typeof CAPTURE_KINDS)[number];
export type CaptureBout = {
  id: string; kind: CaptureKind; startMs: number; endMs: number | null;
  /** Null means the scout could not count it. Zero is an explicit observation. */
  count: number | null; voided?: true;
};
export type MatchCapture = { version: 1; seasonYear: 2026; clockStartedAt: number; bouts: CaptureBout[]; firstInactiveAlliance?: "red" | "blue" | "unknown" };
export const REBUILT_MATCH_MS = 163_000;

function object(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

/** Also used on queued, imported and API payloads; malformed metadata cannot become analytics. */
export function validateMatchCapture(value: unknown, requireClosed = true): string[] {
  if (value === undefined) return [];
  if (!object(value) || value.version !== 1 || value.seasonYear !== 2026 ||
    !Number.isSafeInteger(value.clockStartedAt) || (value.clockStartedAt as number) <= 0 ||
    !Array.isArray(value.bouts) || value.bouts.length > 300 ||
    (value.firstInactiveAlliance !== undefined && !["red", "blue", "unknown"].includes(value.firstInactiveAlliance as string))) return ["Match activity has an unsupported version or format"];
  const ids = new Set<string>();
  let lastEnd = 0;
  let open = false;
  for (const bout of value.bouts) {
    if (!object(bout) || typeof bout.id !== "string" || !/^[a-zA-Z0-9-]{1,80}$/.test(bout.id) || ids.has(bout.id) ||
      !CAPTURE_KINDS.includes(bout.kind as CaptureKind) || !Number.isInteger(bout.startMs) ||
      (bout.startMs as number) < 0 || (bout.startMs as number) >= REBUILT_MATCH_MS ||
      (bout.endMs !== null && (!Number.isInteger(bout.endMs) || (bout.endMs as number) <= (bout.startMs as number) || (bout.endMs as number) > REBUILT_MATCH_MS)) ||
      (bout.count !== null && (!Number.isInteger(bout.count) || (bout.count as number) < 0 || (bout.count as number) > 1000)) ||
      ((bout.kind === "defending" || bout.kind === "disabled" || bout.endMs === null) && bout.count !== null) ||
      (bout.voided !== undefined && bout.voided !== true)) return ["Match activity contains an invalid bout"];
    ids.add(bout.id);
    if (bout.voided) continue;
    if (open || (bout.startMs as number) < lastEnd) return ["Match activities cannot overlap"];
    open = bout.endMs === null;
    lastEnd = (bout.endMs ?? bout.startMs) as number;
  }
  return requireClosed && open ? ["Stop the current match activity before saving"] : [];
}

export function matchCapture(payload: Record<string, unknown>): MatchCapture | null {
  const value = payload[MATCH_CAPTURE_KEY];
  return value !== undefined && !validateMatchCapture(value, false).length ? value as MatchCapture : null;
}

export function activeCaptureBout(capture: MatchCapture | null): CaptureBout | null {
  return capture?.bouts.find(bout => !bout.voided && bout.endMs === null) ?? null;
}

export function startCaptureBout(payload: Record<string, unknown>, input: { id: string; kind: CaptureKind; elapsedMs: number; clockStartedAt: number }): Record<string, unknown> {
  const previous = matchCapture(payload);
  if (payload[MATCH_CAPTURE_KEY] !== undefined && !previous) throw new Error("The recorded activity is damaged. Export it before starting again.");
  if (previous && previous.clockStartedAt !== input.clockStartedAt) throw new Error("This activity belongs to a different match clock.");
  const capture: MatchCapture = { ...previous, version: 1, seasonYear: 2026, clockStartedAt: input.clockStartedAt, bouts: [...(previous?.bouts ?? []), { id: input.id, kind: input.kind, startMs: Math.floor(input.elapsedMs), endMs: null, count: null }] };
  const errors = validateMatchCapture(capture, false);
  if (errors.length) throw new Error(errors[0]);
  return { ...payload, [MATCH_CAPTURE_KEY]: capture };
}

/** FMS confirms the first inactive hub, including an autonomous tie. Never guess from totals. */
export function setCaptureHubOrder(payload: Record<string, unknown>, firstInactiveAlliance: NonNullable<MatchCapture["firstInactiveAlliance"]>, clockStartedAt: number): Record<string, unknown> {
  const previous = matchCapture(payload);
  if (previous && previous.clockStartedAt !== clockStartedAt) throw new Error("This activity belongs to a different match clock.");
  const capture: MatchCapture = { ...previous, version: 1, seasonYear: 2026, clockStartedAt, bouts: previous?.bouts ?? [], firstInactiveAlliance };
  const errors = validateMatchCapture(capture, false);
  if (errors.length) throw new Error(errors[0]);
  return { ...payload, [MATCH_CAPTURE_KEY]: capture };
}

export function finishCaptureBout(payload: Record<string, unknown>, id: string, elapsedMs: number): Record<string, unknown> {
  const capture = matchCapture(payload);
  const active = activeCaptureBout(capture);
  if (!capture || active?.id !== id) return payload;
  const endMs = Math.min(REBUILT_MATCH_MS, Math.floor(elapsedMs));
  if (endMs <= active.startMs) throw new Error("Let the activity run before stopping it.");
  return { ...payload, [MATCH_CAPTURE_KEY]: { ...capture, bouts: capture.bouts.map(bout => bout.id === id ? { ...bout, endMs } : bout) } };
}

/** Corrections retain the original interval. Voided bouts never contribute to analysis. */
export function correctCaptureBout(payload: Record<string, unknown>, id: string, correction: { count: number | null } | { voided: true }): Record<string, unknown> {
  const capture = matchCapture(payload);
  if (!capture) return payload;
  const next = { ...capture, bouts: capture.bouts.map(bout => bout.id === id ? { ...bout, ...correction } : bout) };
  const errors = validateMatchCapture(next, false);
  if (errors.length) throw new Error(errors[0]);
  return { ...payload, [MATCH_CAPTURE_KEY]: next };
}

export function captureSummary(capture: MatchCapture) {
  const result = Object.fromEntries(CAPTURE_KINDS.map(kind => [kind, { bouts: 0, seconds: 0, countedSeconds: 0, count: 0, countedBouts: 0, unknownBouts: 0, perSecond: null as number | null }])) as Record<CaptureKind, { bouts: number; seconds: number; countedSeconds: number; count: number; countedBouts: number; unknownBouts: number; perSecond: number | null }>;
  for (const bout of capture.bouts) {
    if (bout.voided || bout.endMs === null) continue;
    const metric = result[bout.kind];
    const seconds = (bout.endMs - bout.startMs) / 1000;
    metric.bouts++; metric.seconds += seconds;
    if (bout.count !== null) { metric.count += bout.count; metric.countedSeconds += seconds; metric.countedBouts++; }
    else metric.unknownBouts++;
  }
  for (const metric of Object.values(result)) metric.perSecond = metric.countedSeconds > 0 ? metric.count / metric.countedSeconds : null;
  return result;
}

export function restoreCaptureBout(payload: Record<string, unknown>, id: string): Record<string, unknown> {
  const capture = matchCapture(payload);
  if (!capture) return payload;
  const next = { ...capture, bouts: capture.bouts.map(bout => {
    if (bout.id !== id || !bout.voided) return bout;
    const restored = { ...bout };
    delete restored.voided;
    return restored;
  }) };
  const errors = validateMatchCapture(next, false);
  if (errors.length) throw new Error(errors[0]);
  return { ...payload, [MATCH_CAPTURE_KEY]: next };
}
