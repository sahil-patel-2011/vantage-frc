/**
 * Video-Pi analysis: stitch vision-language observations into a structured
 * match record. Real numbers only come from a vision adapter; the fake
 * adapter is for tests. Scouted counts are never overwritten — the UI shows
 * "from video (confidence 0.7)" for a human to confirm.
 */

export type VideoSourceKind = "tba" | "youtube" | "upload" | "pit_stream";

export type VideoEventKind =
  | "score"
  | "climb"
  | "foul"
  | "defense"
  | "stall"
  | "auto_start"
  | "endgame_start"
  | "cycle";

export type VideoObservation = {
  tSec: number;
  kind: VideoEventKind;
  teamKey?: string;
  label: string;
  confidence: number;
};

export type VideoAnalysisRecord = {
  matchKey: string | null;
  sourceKind: VideoSourceKind;
  sourceRef: string;
  model: string;
  analyzedAt: string;
  minutesBehindLive: number | null;
  summary: string;
  events: VideoObservation[];
  cyclesByTeam: Array<{ teamKey: string; cycles: number; confidence: number }>;
};

export type VisionAdapter = {
  model: string;
  observe: (input: { frames: Array<{ tSec: number; caption?: string }> }) => Promise<VideoObservation[]>;
};

export function sampleFrames(durationSec: number): number[] {
  const duration = Math.max(1, durationSec);
  const times: number[] = [];
  // Dense in auto (0–18s) and endgame (last 30s); sparse in teleop.
  for (let t = 0; t <= Math.min(18, duration); t += 2) times.push(t);
  const teleopEnd = Math.max(18, duration - 30);
  for (let t = 20; t < teleopEnd; t += 8) times.push(t);
  for (let t = Math.max(18, duration - 30); t <= duration; t += 2) times.push(t);
  return [...new Set(times.map((t) => Math.min(duration, t)))].sort((a, b) => a - b);
}

export function minutesBehindLive(capturedAt: Date, analyzedAt: Date): number {
  return Math.max(0, Math.round((analyzedAt.getTime() - capturedAt.getTime()) / 60000));
}

export function stitchObservations(input: {
  matchKey: string | null;
  sourceKind: VideoSourceKind;
  sourceRef: string;
  model: string;
  analyzedAt?: Date;
  capturedAt?: Date | null;
  observations: VideoObservation[];
}): VideoAnalysisRecord {
  const analyzedAt = input.analyzedAt ?? new Date();
  const events = [...input.observations].sort((a, b) => a.tSec - b.tSec);
  const cycles = new Map<string, { cycles: number; conf: number[] }>();
  for (const event of events) {
    if (event.kind !== "cycle" || !event.teamKey) continue;
    const row = cycles.get(event.teamKey) ?? { cycles: 0, conf: [] };
    row.cycles += 1;
    row.conf.push(event.confidence);
    cycles.set(event.teamKey, row);
  }
  const summaryParts: string[] = [];
  if (events.some((event) => event.kind === "climb")) summaryParts.push("Climbs were visible.");
  if (events.some((event) => event.kind === "foul")) summaryParts.push("Fouls were flagged.");
  if (events.some((event) => event.kind === "stall")) summaryParts.push("At least one robot stalled.");
  if (!summaryParts.length) {
    summaryParts.push(events.length ? "Events were spotted in the video." : "No events were spotted in this clip.");
  }
  return {
    matchKey: input.matchKey,
    sourceKind: input.sourceKind,
    sourceRef: input.sourceRef,
    model: input.model,
    analyzedAt: analyzedAt.toISOString(),
    minutesBehindLive: input.capturedAt ? minutesBehindLive(input.capturedAt, analyzedAt) : null,
    summary: summaryParts.join(" "),
    events,
    cyclesByTeam: [...cycles.entries()].map(([teamKey, row]) => ({
      teamKey,
      cycles: row.cycles,
      confidence:
        Math.round((row.conf.reduce((sum, value) => sum + value, 0) / row.conf.length) * 100) / 100,
    })),
  };
}

export function formatVideoCitation(item: { confidence: number }): string {
  const conf = Math.max(0, Math.min(1, item.confidence));
  return `from video (confidence ${conf.toFixed(1)})`;
}

export async function analyzeClip(
  adapter: VisionAdapter,
  input: {
    matchKey: string | null;
    sourceKind: VideoSourceKind;
    sourceRef: string;
    durationSec: number;
    capturedAt?: Date | null;
  },
): Promise<VideoAnalysisRecord> {
  const frames = sampleFrames(input.durationSec).map((tSec) => ({ tSec }));
  const observations = await adapter.observe({ frames });
  return stitchObservations({
    matchKey: input.matchKey,
    sourceKind: input.sourceKind,
    sourceRef: input.sourceRef,
    model: adapter.model,
    capturedAt: input.capturedAt ?? null,
    observations,
  });
}

/** Test double — never used for product UI. */
export function fakeVisionAdapter(scripted: VideoObservation[]): VisionAdapter {
  return {
    model: "fake-vision",
    async observe() {
      return scripted;
    },
  };
}
