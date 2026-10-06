import { describe, expect, it } from "vitest";
import { activeCaptureBout, applyFormResetBehavior, captureSummary, correctCaptureBout, finishCaptureBout, matchCapture, MATCH_CAPTURE_KEY, restoreCaptureBout, setCaptureHubOrder, startCaptureBout, validateMatchCapture, validatePayload } from "./index";
import { decodeScoutQrContent, encodeScoutQrPayload } from "./qr-handoff";

const startedAt = 1791288000000;
function shooting(count: number | null = 20) {
  let payload = startCaptureBout({}, { id: "shoot-1", kind: "shooting", elapsedMs: 1000, clockStartedAt: startedAt });
  payload = finishCaptureBout(payload, "shoot-1", 11000);
  return correctCaptureBout(payload, "shoot-1", { count });
}
describe("match-relative scouting", () => {
  it("keeps confirmed FMS order through subsequent activity without inferring a winner", () => {
    const selected = setCaptureHubOrder({}, "blue", startedAt);
    const next = startCaptureBout(selected, { id: "feed", kind: "feeding", elapsedMs: 40000, clockStartedAt: startedAt });
    expect(matchCapture(next)?.firstInactiveAlliance).toBe("blue");
    expect(matchCapture(shooting())?.firstInactiveAlliance).toBeUndefined();
    expect(() => setCaptureHubOrder(next, "red", startedAt + 1)).toThrow(/different match clock/);
  });
  it("measures counted intervals without extrapolating to game points", () => {
    const summary = captureSummary(matchCapture(shooting())!);
    expect(summary.shooting).toMatchObject({ seconds: 10, count: 20, perSecond: 2, countedBouts: 1 });
    expect(summary.defending).toMatchObject({ bouts: 0, perSecond: null });
  });
  it("excludes uncounted bouts from the numerator and denominator, but preserves duration", () => {
    let payload = startCaptureBout(shooting(), { id: "shoot-2", kind: "shooting", elapsedMs: 12000, clockStartedAt: startedAt });
    payload = finishCaptureBout(payload, "shoot-2", 32000);
    expect(captureSummary(matchCapture(payload)!).shooting).toMatchObject({ seconds: 30, countedSeconds: 10, perSecond: 2, unknownBouts: 1 });
    expect(captureSummary(matchCapture(shooting(null))!).shooting.perSecond).toBeNull();
    expect(captureSummary(matchCapture(shooting(0))!).shooting.perSecond).toBe(0);
  });
  it("keeps unfinished activity in a restored draft and rejects saving it", () => {
    const payload = startCaptureBout({}, { id: "defense", kind: "defending", elapsedMs: 40000, clockStartedAt: startedAt });
    const restored = JSON.parse(JSON.stringify(payload));
    expect(activeCaptureBout(matchCapture(restored))?.id).toBe("defense");
    expect(validatePayload({ title: "Match", fields: [] }, restored)).toEqual(["Stop the current match activity before saving"]);
    expect(validatePayload({ title: "Match", fields: [] }, finishCaptureBout(restored, "defense", 163000))).toEqual([]);
  });
  it("prevents overlapping observations, repeated IDs, and changing the match clock", () => {
    const active = startCaptureBout({}, { id: "shoot", kind: "shooting", elapsedMs: 1000, clockStartedAt: startedAt });
    expect(() => startCaptureBout(active, { id: "feed", kind: "feeding", elapsedMs: 2000, clockStartedAt: startedAt })).toThrow(/overlap/);
    expect(() => startCaptureBout(shooting(), { id: "shoot-1", kind: "shooting", elapsedMs: 12000, clockStartedAt: startedAt })).toThrow(/invalid bout/);
    expect(() => startCaptureBout(shooting(), { id: "feed", kind: "feeding", elapsedMs: 12000, clockStartedAt: startedAt + 1000 })).toThrow(/different match clock/);
  });
  it("retains removed intervals for review but excludes them from metrics", () => {
    const corrected = correctCaptureBout(shooting(), "shoot-1", { voided: true });
    expect(matchCapture(corrected)?.bouts[0]?.voided).toBe(true);
    expect(captureSummary(matchCapture(corrected)!).shooting.bouts).toBe(0);
    expect(captureSummary(matchCapture(restoreCaptureBout(corrected, "shoot-1"))!).shooting.perSecond).toBe(2);
  });
  it("caps intervals at the buzzer and rejects zero duration", () => {
    const payload = startCaptureBout({}, { id: "end", kind: "disabled", elapsedMs: 160000, clockStartedAt: startedAt });
    expect(() => finishCaptureBout(payload, "end", 160000)).toThrow(/run/);
    expect(matchCapture(finishCaptureBout(payload, "end", 200000))?.bouts[0]?.endMs).toBe(163000);
  });
  it.each([-1, 1.5, 1001, NaN, Infinity])("rejects invalid count %s", count => {
    expect(() => correctCaptureBout(shooting(), "shoot-1", { count })).toThrow(/invalid bout/);
  });
  it("rejects malformed metadata and bounded collections before analysis", () => {
    expect(validateMatchCapture({ version: 2 })).not.toEqual([]);
    const valid = matchCapture(shooting())!;
    expect(validateMatchCapture({ ...valid, bouts: Array.from({ length: 301 }, () => valid.bouts[0]) })).not.toEqual([]);
    expect(matchCapture({ [MATCH_CAPTURE_KEY]: { ...valid, bouts: [{ ...valid.bouts[0], count: "20" }] } })).toBeNull();
  });
  it("round-trips activity through portable QR without changing counts or time", () => {
    const payload = shooting(0);
    const record = { clientId: "report", orgId: "org", schemaId: "schema", eventKey: "2026test", matchKey: "2026test_qm1", teamKey: "frc254", scoutUserId: "user", type: "match" as const, payload, confidence: "normal" as const, source: "manual" as const, deviceId: "device" };
    const decoded = decodeScoutQrContent(encodeScoutQrPayload([record]));
    expect(decoded).toMatchObject({ kind: "embedded" });
    if (decoded.kind === "embedded") expect(decoded.records[0]?.payload[MATCH_CAPTURE_KEY]).toEqual(payload[MATCH_CAPTURE_KEY]);
  });
  it("resets capture for the next robot without carrying prior observations", () => {
    expect(applyFormResetBehavior({ title: "Match", fields: [] }, shooting())).toEqual({});
  });
});
