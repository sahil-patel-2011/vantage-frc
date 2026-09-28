import { describe, expect, it } from "vitest";
import { AppsScriptBridge } from "./apps-script-bridge";

describe("bounded idempotent Google bridge retries", () => {
  const url = "https://script.google.com/macros/s/acceptance-test-bridge-123456/exec";
  it("retries unavailable idempotent operations with fresh signatures and exponential delay", async () => {
    let attempts = 0;
    let time = 0;
    const timestamps: number[] = [];
    const delays: number[] = [];
    const bridge = new AppsScriptBridge(url, "a".repeat(64), {
      now: () => ++time, random: () => 0, sleep: async (delay) => { delays.push(delay); },
      fetchImpl: async (_input, init) => {
        timestamps.push(JSON.parse(String(init?.body)).ts);
        if (++attempts < 3) throw new Error("network unavailable");
        return Response.json({ ok: true, id: "same-workbook" });
      },
    });
    expect(await bridge.call("team.ensure", { team: { key: "stable" } })).toMatchObject({ id: "same-workbook" });
    expect(timestamps).toEqual([1, 2, 3]);
    expect(delays).toEqual([1000, 2000]);
  });
  it("does not retry authentication failure or arbitrary mutations", async () => {
    for (const [action, unavailable] of [["team.ensure", false], ["drive.upload", true]] as const) {
      let attempts = 0;
      const bridge = new AppsScriptBridge(url, "a".repeat(64), { fetchImpl: async () => { attempts++; if (unavailable) throw new Error("network"); return Response.json({ ok: false, error: "signature" }); }, sleep: async () => {} });
      await expect(bridge.call(action)).rejects.toThrow();
      expect(attempts).toBe(1);
    }
  });
  it("defers daily quota to durable execution without in-process sleeps", async () => {
    for (const data of [
      { ok: false, error: "Daily limit", code: "daily_quota", retryAfterMs: 7_200_000 },
      { ok: false, error: "Limit exceeded: Spreadsheets." },
      { ok: false, error: "Service invoked too many times for one day: spreadsheet." },
      { ok: false, error: "Service invoked too many times: Spreadsheet." },
    ]) {
      let attempts = 0;
      const delays: number[] = [];
      const bridge = new AppsScriptBridge(url, "a".repeat(64), { fetchImpl: async () => { attempts++; return Response.json(data); }, sleep: async (ms) => { delays.push(ms); } });
      await expect(bridge.call("team.ensure")).rejects.toMatchObject({ kind: "throttled", code: "daily_quota", retryAfterMs: "retryAfterMs" in data ? data.retryAfterMs : 86_400_000 });
      expect(attempts).toBe(1);
      expect(delays).toEqual([]);
    }
  });
  it("keeps short service throttling separate from a daily quota wait", async () => {
    let attempts = 0;
    const delays: number[] = [];
    const bridge = new AppsScriptBridge(url, "a".repeat(64), { maxAttempts: 2, random: () => 0, fetchImpl: async () => { attempts++; return Response.json({ ok: false, error: "Service invoked too many times in a short time: Spreadsheet." }); }, sleep: async (ms) => { delays.push(ms); } });
    await expect(bridge.call("team.ensure")).rejects.toMatchObject({ kind: "throttled", code: "script_throttled" });
    expect(attempts).toBe(2);
    expect(delays).toEqual([1000]);
  });
});
