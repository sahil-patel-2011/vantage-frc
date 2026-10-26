import { afterEach, describe, expect, it, vi } from "vitest";
import { dispatchCron, internalCronOrigin } from "./dispatch-cron";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("internalCronOrigin", () => {
  it("prefers an explicit origin, then the hosted host, then a local port", () => {
    expect(internalCronOrigin({ VANTAGE_INTERNAL_ORIGIN: "https://vantage.example/" } as NodeJS.ProcessEnv)).toBe(
      "https://vantage.example",
    );
    expect(internalCronOrigin({ VERCEL_URL: "preview.example" } as NodeJS.ProcessEnv)).toBe("https://preview.example");
    expect(internalCronOrigin({ NODE_ENV: "development", PORT: "3001" } as NodeJS.ProcessEnv)).toBe(
      "http://127.0.0.1:3001",
    );
  });

  it("does not invent an origin when nothing is configured", () => {
    expect(internalCronOrigin({ NODE_ENV: "production" } as NodeJS.ProcessEnv)).toBe("");
  });
});

describe("dispatchCron", () => {
  it("posts the job to the cron route with the secret and returns the body", async () => {
    vi.stubEnv("CRON_SECRET", "cron-secret");
    const fetchImpl = vi.fn(async () => Response.json({ summary: { matches: 2 } }));
    const result = await dispatchCron(
      "/api/cron/reference-refresh",
      { kind: "event-day", eventKeys: ["2026test"] },
      { fetchImpl, origin: "https://vantage.example" },
    );
    expect(result).toEqual({ ok: true, body: { summary: { matches: 2 } } });
    expect(fetchImpl).toHaveBeenCalledWith("https://vantage.example/api/cron/reference-refresh", {
      method: "POST",
      headers: { authorization: "Bearer cron-secret", "content-type": "application/json" },
      body: JSON.stringify({ kind: "event-day", eventKeys: ["2026test"] }),
    });
  });

  it("stays pending when the secret or the origin is missing, and does not call fetch", async () => {
    const fetchImpl = vi.fn();
    expect(await dispatchCron("/api/cron/team-dream", {}, { fetchImpl, origin: "https://vantage.example" })).toEqual({
      ok: false,
      pending: true,
      reason: "cron_unconfigured",
    });
    vi.stubEnv("CRON_SECRET", "cron-secret");
    expect(await dispatchCron("/api/cron/team-dream", {}, { fetchImpl, origin: "" })).toEqual({
      ok: false,
      pending: true,
      reason: "cron_unconfigured",
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("stays pending when the cron route rejects the call", async () => {
    vi.stubEnv("CRON_SECRET", "cron-secret");
    const fetchImpl = vi.fn(async () => new Response("no", { status: 401 }));
    expect(
      await dispatchCron("/api/cron/reference-refresh", { kind: "event-day" }, { fetchImpl, origin: "https://vantage.example" }),
    ).toEqual({ ok: false, pending: true, reason: "cron_rejected" });
  });
});
