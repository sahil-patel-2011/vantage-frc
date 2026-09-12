import { describe, expect, it } from "vitest";
import {
  createOnshapeStubAdapter,
  executeViaMockFusionPlugin,
  resolveCadMetering,
  runMockCadAgentLoop,
} from "../src/agent-loop";

describe("CAD mock agent loop", () => {
  it("runs plan → approve → execute → verify end-to-end against the mock adapter", async () => {
    const result = await runMockCadAgentLoop({
      request: "Build a roller intake within a 12in envelope",
      brainMode: "mock",
      autoApprove: true,
      autoRunVerify: true,
    });
    expect(result.sanitizedRequest).toContain("<untrusted_user_or_context>");
    expect(result.plan.length).toBeGreaterThanOrEqual(3);
    expect(result.steps.every((step) => step.status === "completed")).toBe(true);
    expect(result.finalFingerprint).toMatch(/^[a-f0-9]{64}$/);
    expect(result.totalVantageCostUsd).toBe(0);
  });

  it("keeps terminal_cli Vantage metering at cost 0 with key_source local_cli", async () => {
    expect(resolveCadMetering("terminal_cli")).toEqual({
      keySource: "local_cli",
      costUsd: 0,
      billing: expect.stringMatching(/local_cli|No Vantage/i),
    });
    const result = await runMockCadAgentLoop({
      request: "Local Claude Code brain path",
      brainMode: "terminal_cli",
      autoApprove: true,
    });
    expect(result.metering.keySource).toBe("local_cli");
    expect(result.totalVantageCostUsd).toBe(0);
    expect(result.steps.some((step) => step.status === "completed")).toBe(true);
  });

  it("keeps personal Claude Code metering at cost 0 with key_source local_cli", () => {
    expect(resolveCadMetering("claude_code_personal")).toEqual({
      keySource: "local_cli",
      costUsd: 0,
      billing: expect.stringMatching(/local_cli|No Vantage/i),
    });
  });

  it("halts mutations when approvals are withheld", async () => {
    const result = await runMockCadAgentLoop({
      request: "Need human gate",
      autoApprove: false,
      autoRunVerify: true,
    });
    const rejected = result.steps.filter((step) => step.status === "rejected");
    expect(rejected.length).toBeGreaterThan(0);
    expect(result.steps.find((step) => step.operation === "create_extrude")?.status).toBe("rejected");
  });

  it("executes through the mock Fusion plugin with signed envelopes", async () => {
    const executed = await executeViaMockFusionPlugin({
      operation: {
        operation: "verify_topology",
        parameters: { views: ["iso"] },
        requiresApproval: true,
        reason: "verify",
      },
    });
    expect(executed.topology.fingerprint).toMatch(/^[a-f0-9]{64}$/);
    expect(executed.output).toMatchObject({ mockFusion: true });
  });

  it("supports the Onshape stub adapter without OAuth credentials", async () => {
    const result = await runMockCadAgentLoop({
      request: "Onshape stub path",
      adapter: createOnshapeStubAdapter(),
      autoApprove: true,
      autoRunVerify: true,
    });
    expect(result.steps.every((step) => step.status === "completed")).toBe(true);
    expect(result.steps[0]?.result?.output).toMatchObject({ onshapeStub: true });
  });
});
