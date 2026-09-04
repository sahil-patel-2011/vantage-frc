import { describe, expect, it } from "vitest";
import {
  averageOutTokensPerSec,
  estimateTokensFromText,
  longSlotCap,
  PiDeviceTelemetry,
  prioritySlotCap,
  readUsageFromCompletionBody,
  readUsageFromSse,
  sanitizeFeatureLabel,
} from "../src/device-telemetry";

describe("device telemetry", () => {
  it("never invents tokens from an empty body", () => {
    expect(estimateTokensFromText("")).toBe(0);
    expect(readUsageFromCompletionBody("not-json")).toBeNull();
    expect(readUsageFromCompletionBody(JSON.stringify({ choices: [] }))).toBeNull();
  });

  it("reads real usage objects and estimates only as a fallback", () => {
    expect(
      readUsageFromCompletionBody(JSON.stringify({ usage: { prompt_tokens: 12, completion_tokens: 40 } })),
    ).toEqual({ prompt: 12, completion: 40 });
    expect(estimateTokensFromText("abcd")).toBe(1);
    expect(
      readUsageFromSse('data: {"usage":{"prompt_tokens":3,"completion_tokens":9}}\n\n'),
    ).toEqual({ prompt: 3, completion: 9 });
  });

  it("averages output tokens over the last minute without fabricating a rate", () => {
    expect(averageOutTokensPerSec([], 60_000)).toBe(0);
    expect(averageOutTokensPerSec([{ atMs: 50_000, tokens: 120 }], 60_000, 60_000)).toBe(2);
  });

  it("allows concurrent in-flight requests and refuses past the cap", () => {
    const telemetry = new PiDeviceTelemetry(2);
    expect(telemetry.tryBegin("chat")).toBe(true);
    expect(telemetry.tryBegin("cad")).toBe(true);
    expect(telemetry.tryBegin("agent")).toBe(false);
    expect(telemetry.snapshot().activeRequests).toBe(2);
    expect(telemetry.snapshot().byFeature).toEqual({ chat: 1, cad: 1 });
    telemetry.end("chat");
    expect(telemetry.tryBegin("agent")).toBe(true);
    expect(sanitizeFeatureLabel("CAD Assistant!!")).toBe("cadassistant");
  });

  it("keeps most slots for short chat while long jobs run", () => {
    expect(longSlotCap(16)).toBe(4);
    const telemetry = new PiDeviceTelemetry(16);
    expect(telemetry.tryBegin("deep_game_analysis")).toBe(true);
    expect(telemetry.tryBegin("memory_dream")).toBe(true);
    expect(telemetry.tryBegin("overnight_intel")).toBe(true);
    expect(telemetry.tryBegin("team_dream")).toBe(true);
    expect(telemetry.canBegin("team_dream_week")).toBe("long_cap");
    expect(telemetry.tryBegin("team_dream_week")).toBe(false);
    expect(prioritySlotCap(16)).toBe(2);
    for (let i = 0; i < 10; i += 1) {
      expect(telemetry.tryBegin("chat")).toBe(true);
    }
    expect(telemetry.canBegin("chat")).toBe("full");
    expect(telemetry.tryBegin("cad")).toBe(false);
    expect(telemetry.tryBegin("chat", { priority: true })).toBe(true);
    expect(telemetry.tryBegin("chat", { priority: true })).toBe(true);
    expect(telemetry.canBegin("chat", { priority: true })).toBe("full");
    expect(telemetry.snapshot().longInFlight).toBe(4);
    expect(telemetry.snapshot().longSlotCap).toBe(4);
    expect(telemetry.snapshot().priorityReservedInFlight).toBe(2);
  });

  it("lets team 6925 take reserved seats without cancelling other in-flight work", () => {
    const telemetry = new PiDeviceTelemetry(16);
    for (let i = 0; i < 14; i += 1) {
      expect(telemetry.tryBegin("chat")).toBe(true);
    }
    expect(telemetry.tryBegin("chat")).toBe(false);
    const first = telemetry.beginSlot("chat", { priority: true });
    expect(first).toEqual({ ok: true, reserved: true });
    expect(telemetry.tryBegin("chat")).toBe(false);
    expect(telemetry.snapshot().activeRequests).toBe(15);
    telemetry.end("chat");
    expect(telemetry.tryBegin("cad")).toBe(true);
    expect(telemetry.snapshot().priorityReservedInFlight).toBe(1);
    expect(telemetry.snapshot().activeRequests).toBe(15);
  });

  it("records in/out tokens for the UTC day", () => {
    const telemetry = new PiDeviceTelemetry(8, () => Date.parse("2026-09-02T16:00:00.000Z"));
    telemetry.record(100, 40);
    telemetry.record(20, 10);
    const snap = telemetry.snapshot();
    expect(snap.day).toBe("2026-09-02");
    expect(snap.tokensIn).toBe(120);
    expect(snap.tokensOut).toBe(50);
  });
});
