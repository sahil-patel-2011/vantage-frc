import { describe, expect, it } from "vitest";
import {
  analyzeClip,
  fakeVisionAdapter,
  formatVideoCitation,
  sampleFrames,
  stitchObservations,
} from "../src/video-analysis";

describe("video analysis pipeline", () => {
  it("samples auto and endgame densely", () => {
    const frames = sampleFrames(150);
    expect(frames[0]).toBe(0);
    expect(frames.filter((t) => t <= 18).length).toBeGreaterThan(5);
    expect(frames.filter((t) => t >= 120).length).toBeGreaterThan(5);
  });

  it("stitches events and never merges them into scouted counts", () => {
    const record = stitchObservations({
      matchKey: "2026arc_qm12",
      sourceKind: "youtube",
      sourceRef: "https://youtu.be/example",
      model: "fake-vision",
      capturedAt: new Date("2026-04-04T18:00:00Z"),
      analyzedAt: new Date("2026-04-04T18:08:00Z"),
      observations: [
        { tSec: 12, kind: "cycle", teamKey: "frc6925", label: "coral L4", confidence: 0.7 },
        { tSec: 40, kind: "cycle", teamKey: "frc6925", label: "coral L4", confidence: 0.6 },
        { tSec: 140, kind: "climb", teamKey: "frc6925", label: "deep climb", confidence: 0.8 },
      ],
    });
    expect(record.minutesBehindLive).toBe(8);
    expect(record.cyclesByTeam[0]).toEqual({ teamKey: "frc6925", cycles: 2, confidence: 0.65 });
    expect(formatVideoCitation({ confidence: 0.7 })).toBe("from video (confidence 0.7)");
    expect(record.summary).toMatch(/Climb/i);
  });

  it("runs the fake vision adapter end to end", async () => {
    const record = await analyzeClip(
      fakeVisionAdapter([
        { tSec: 5, kind: "auto_start", label: "auto begins", confidence: 0.9 },
      ]),
      {
        matchKey: null,
        sourceKind: "upload",
        sourceRef: "files:fixture.mp4",
        durationSec: 20,
      },
    );
    expect(record.model).toBe("fake-vision");
    expect(record.events).toHaveLength(1);
  });
});
