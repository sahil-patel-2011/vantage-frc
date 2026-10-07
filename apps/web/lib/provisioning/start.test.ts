import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { startTeamProvisioning } from "./start";

const fake = vi.hoisted(() => ({ start: vi.fn(), query: vi.fn(), rls: vi.fn() }));
vi.mock("workflow/api", () => ({ start: fake.start }));
vi.mock("./workflow", () => ({ teamProvisioningWorkflow: vi.fn() }));
vi.mock("@vantage/db", () => ({ withRls: fake.rls }));

beforeEach(() => {
  vi.clearAllMocks();
  fake.start.mockResolvedValue({ runId: "controlled-run" });
  fake.query.mockResolvedValue({ rows: [], rowCount: 1 });
  fake.rls.mockImplementation(async (_scope, work) => work({ query: fake.query }));
});
afterEach(() => vi.unstubAllEnvs());

describe("optional hosted team copies", () => {
  it.each([undefined, "", "0", "true"])("does not start or acquire a connection without explicit enablement: %s", async value => {
    vi.stubEnv("NEXT_PUBLIC_VANTAGE_HOSTED_BACKGROUND_ENABLED", value);
    expect(await startTeamProvisioning("team", "owner")).toBe(false);
    expect(fake.start).not.toHaveBeenCalled();
    expect(fake.rls).not.toHaveBeenCalled();
  });

  it("records a run only after an explicitly enabled dispatch succeeds", async () => {
    vi.stubEnv("NEXT_PUBLIC_VANTAGE_HOSTED_BACKGROUND_ENABLED", "1");
    expect(await startTeamProvisioning("team", "owner")).toBe(true);
    expect(fake.start).toHaveBeenCalledOnce();
    expect(fake.rls).toHaveBeenCalledWith({ userId: "owner", orgId: "team" }, expect.any(Function));
    expect(fake.query).toHaveBeenCalledWith(expect.stringContaining("workflow_run_id=$2"), ["team", "controlled-run"]);
  });

  it("reports dispatch failure and records a recoverable error instead of success", async () => {
    vi.stubEnv("NEXT_PUBLIC_VANTAGE_HOSTED_BACKGROUND_ENABLED", "1");
    fake.start.mockRejectedValueOnce(new Error("Provider unavailable"));
    expect(await startTeamProvisioning("team", "owner")).toBe(false);
    expect(fake.query).toHaveBeenCalledWith(expect.stringContaining("state='failed'"), ["team"]);
    expect(fake.query).not.toHaveBeenCalledWith(expect.stringContaining("workflow_run_id=$2"), expect.anything());
  });

  it("does not fail a committed team claim when optional dispatch and its bookkeeping are unavailable", async () => {
    vi.stubEnv("NEXT_PUBLIC_VANTAGE_HOSTED_BACKGROUND_ENABLED", "1");
    fake.start.mockRejectedValueOnce(new Error("Provider unavailable"));
    fake.rls.mockRejectedValueOnce(new Error("Bookkeeping unavailable"));
    expect(await startTeamProvisioning("team", "owner")).toBe(false);
  });
});
