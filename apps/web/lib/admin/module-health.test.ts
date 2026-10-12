import { describe, expect, it } from "vitest";
import type { IntegrationCheck } from "./integration-health";
import { buildModuleHealth, jobStatus, MODULE_IDS, redactSecrets, type ModuleHealthInputs } from "./module-health";

const NOW = new Date("2026-10-11T12:00:00Z");

function check(id: string, state: IntegrationCheck["state"], extra: Partial<IntegrationCheck> = {}): IntegrationCheck {
  return {
    id,
    category: extra.category ?? "Test",
    label: extra.label ?? id,
    state,
    verification: extra.verification ?? "config_only",
    reason: extra.reason ?? `${id} is ${state}`,
    lastSuccessAt: extra.lastSuccessAt ?? null,
    remediation: null,
  };
}

function inputs(overrides: Partial<ModuleHealthInputs> = {}): ModuleHealthInputs {
  return {
    now: NOW,
    checks: [
      check("db-request-role", "healthy", { verification: "live" }),
      check("db-worker-role", "configured"),
      check("better-auth", "configured"),
      check("google-oauth", "setup_required"),
      check("resend-email", "setup_required"),
      check("reference-tba", "healthy", { verification: "live" }),
      check("reference-statbotics", "healthy", { verification: "live" }),
      check("github-oauth", "setup_required"),
      check("onshape-oauth", "setup_required"),
      check("redis-rate-limit", "setup_required"),
      check("cron-secret", "configured"),
      check("cron-reference-ingest", "healthy", { verification: "live" }),
      check("ai-anthropic", "setup_required", { category: "AI" }),
    ],
    outage: { storeKind: "memory", ownerEmailConfigured: true, incident: null },
    reference: [],
    jobs: [],
    pool: [],
    ...overrides,
  };
}

const byId = (modules: ReturnType<typeof buildModuleHealth>, id: string) => modules.find((m) => m.id === id)!;

describe("module health", () => {
  it("lists every module once, in order", () => {
    expect(buildModuleHealth(inputs()).map((m) => m.id)).toEqual([...MODULE_IDS]);
  });

  it("never invents a status: no signal and no configuration is Not set up", () => {
    const modules = buildModuleHealth(inputs({ jobs: [] }));
    expect(byId(modules, "email").status).toBe("not_set_up");
    expect(byId(modules, "nas_sync").status).toBe("not_set_up");
    expect(byId(modules, "spreadsheet_mirror").status).toBe("not_set_up");
    expect(byId(modules, "github").status).toBe("not_set_up");
    expect(byId(modules, "ai_providers").status).toBe("not_set_up");
    expect(byId(modules, "database").status).toBe("healthy");
  });

  it("says a configured-only module was checked from its settings, not live", () => {
    const modules = buildModuleHealth(inputs({ checks: [...inputs().checks.filter((c) => c.id !== "resend-email"), check("resend-email", "configured")] }));
    expect(byId(modules, "email")).toMatchObject({ status: "healthy", checked: "settings" });
  });

  it("maps an ingest error to Down with its error line and when it started", () => {
    const modules = buildModuleHealth(
      inputs({
        checks: [...inputs().checks.filter((c) => c.id !== "reference-tba"), check("reference-tba", "error", { verification: "live", reason: "TBA ingest reported an error (401)." })],
        reference: [{ source: "tba", status: "unavailable", consecutiveFailures: 4, lastSuccessAt: "2026-10-10T08:00:00Z", lastFailureAt: "2026-10-11T11:00:00Z", lastError: "401 Unauthorized X-TBA-Auth-Key=abcd1234secretvalue" }],
      }),
    );
    const tba = byId(modules, "tba");
    expect(tba.status).toBe("down");
    expect(tba.since).toBe("2026-10-11T11:00:00Z");
    expect(tba.logs[0]!.message).toContain("401 Unauthorized");
    expect(tba.logs[0]!.message).not.toContain("abcd1234secretvalue");
    expect(tba.fix.length).toBeGreaterThan(0);
  });

  it("keeps the database Degraded while an outage incident is still open", () => {
    const modules = buildModuleHealth(
      inputs({
        outage: {
          storeKind: "upstash",
          ownerEmailConfigured: true,
          incident: {
            firstSeen: "2026-10-11T11:40:00Z",
            lastSeen: "2026-10-11T11:55:00Z",
            closedAt: null,
            failures: 9,
            title: "Postgres isn't accepting connections",
            why: "The NAS may be off.",
            fix: "Check the NAS is on.",
            causes: ["connection_refused"],
          },
        },
      }),
    );
    const database = byId(modules, "database");
    expect(database.status).toBe("degraded");
    expect(database.since).toBe("2026-10-11T11:40:00Z");
    expect(database.problem).toMatch(/accepting connections/);
    expect(database.fix[0]).toBe("Check the NAS is on.");
  });

  it("marks AI providers degraded by a failing pool key, with its reason and no secret", () => {
    const modules = buildModuleHealth(
      inputs({
        pool: [
          { label: "Main", provider: "anthropic", enabled: true, configured: true, lastUsedAt: "2026-10-11T09:00:00Z", degradedAt: "2026-10-11T10:00:00Z", degradedReason: "Key rejected by the provider (401) sk-ant-api03-abcdefghijklmnop" },
          { label: "Spare", provider: "anthropic", enabled: true, configured: true, lastUsedAt: "2026-10-11T11:00:00Z", degradedAt: null, degradedReason: null },
        ],
      }),
    );
    const ai = byId(modules, "ai_providers");
    expect(ai.status).toBe("degraded");
    expect(ai.summary).toMatch(/1 of 2 pool keys failing: Main/);
    expect(ai.since).toBe("2026-10-11T10:00:00Z");
    expect(JSON.stringify(ai)).not.toContain("sk-ant-api03");
  });

  it("calls AI providers Down when every switched-on pool key is failing", () => {
    const modules = buildModuleHealth(
      inputs({ pool: [{ label: "Main", provider: "anthropic", enabled: true, configured: true, lastUsedAt: null, degradedAt: "2026-10-11T10:00:00Z", degradedReason: "Rate limited by the provider (429)" }] }),
    );
    expect(byId(modules, "ai_providers").status).toBe("down");
  });

  it("reads job tables: never run, failing, stale and fine", () => {
    expect(jobStatus(undefined, NOW, 48)).toBe("not_set_up");
    const base = { source: "x", runs24h: 3, failures24h: 0, openJobs: 0, recentErrors: [] };
    expect(jobStatus({ ...base, lastSuccessAt: "2026-10-11T10:00:00Z", lastFailureAt: "2026-10-11T11:00:00Z" }, NOW, 48)).toBe("down");
    expect(jobStatus({ ...base, failures24h: 1, lastSuccessAt: "2026-10-11T11:00:00Z", lastFailureAt: "2026-10-11T10:00:00Z" }, NOW, 48)).toBe("degraded");
    expect(jobStatus({ ...base, lastSuccessAt: "2026-10-08T10:00:00Z", lastFailureAt: null }, NOW, 48)).toBe("degraded");
    expect(jobStatus({ ...base, lastSuccessAt: "2026-10-11T10:00:00Z", lastFailureAt: null }, NOW, 48)).toBe("healthy");
  });

  it("explains outage alerts honestly: no owner email, or a per-server store", () => {
    expect(byId(buildModuleHealth(inputs({ outage: { storeKind: "memory", ownerEmailConfigured: false, incident: null } })), "outage_alerts").status).toBe("not_set_up");
    expect(byId(buildModuleHealth(inputs()), "outage_alerts").status).toBe("degraded");
    expect(byId(buildModuleHealth(inputs({ outage: { storeKind: "upstash", ownerEmailConfigured: true, incident: null } })), "outage_alerts").status).toBe("healthy");
  });
});

describe("redactSecrets", () => {
  it.each([
    ["postgresql://vantage_app:hunter2@db.example.com:5432/vantage", "hunter2"],
    ["failed with key sk-ant-api03-AbCdEfGhIjKlMnOp", "AbCdEfGhIjKlMnOp"],
    ["OpenAI sk-proj-1234567890abcdef rejected", "1234567890abcdef"],
    ["Google key AIzaSyA1234567890abcdefghijk", "AIzaSyA1234567890"],
    ["Authorization: Bearer abc.def.ghi-token-123456", "abc.def.ghi-token"],
    ["token=supersecretvalue123", "supersecretvalue123"],
    ["x-api-key: sk-live-whatever-1234", "sk-live-whatever"],
    ["github ghp_abcdefghijklmnopqrstuvwxyz0123", "ghp_abcdefghij"],
    ["jwt eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U", "eyJzdWIiOiIxMjM0NTY3ODkwIn0"],
    ["redis rediss://default:pa55@us1-cool.upstash.io:6379", "pa55"],
    ["ciphertext 6b8f1e2d3c4b5a69788796a5b4c3d2e1f0a9b8c7d6e5f4a3", "6b8f1e2d3c4b5a69"],
  ])("removes the secret from %s", (input, secret) => {
    const out = redactSecrets(input);
    expect(out).not.toContain(secret);
  });

  it("keeps the words that say what happened", () => {
    expect(redactSecrets("TBA returned 503 Service Unavailable for /event/2026gacmp/matches")).toBe(
      "TBA returned 503 Service Unavailable for /event/2026gacmp/matches",
    );
    expect(redactSecrets("x".repeat(500)).length).toBeLessThanOrEqual(400);
    expect(redactSecrets(null)).toBe("");
  });
});
