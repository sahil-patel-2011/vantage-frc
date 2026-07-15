/**
 * In-memory CAD agent loop for CI and mock connectors.
 * Proves plan → approve → execute → verify without live Fusion/Onshape/LLM.
 */
import { createHash } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import {
  buildDefaultCadPlan,
  canAutoRunWithinAllowlist,
  cadenceAgentPlanningPrompt,
  describeCadBrainMode,
  isAllowlistedCadOperation,
  requiresDestructiveConfirmation,
  sanitizeUntrustedCadText,
  type CadAction,
  type CadBrainMode,
  type CadOperation,
  type EngineeringBriefLite,
} from "./agent-policy";
import type { CadExecutionResult } from "./fusion-relay";
import { signFusionRelayJob, verifyFusionRelayJob, type FusionRelayEnvelope } from "./fusion-relay";
import { createMockFusionPluginHandler, buildTestFusionEnvelope } from "./mock-fusion-plugin";

export type LoopCadAdapter = {
  readonly platform: "onshape" | "fusion360" | "mock";
  readonly executionMode: "hosted" | "local";
  execute(
    action: CadAction,
    context: { jobId: string; idempotencyKey: string },
  ): Promise<CadExecutionResult>;
};

export type CadMeterResolution = {
  keySource: "local_cli" | "byo" | "platform" | "local";
  costUsd: number;
  billing: string;
};

/** Terminal / local CLI brains never incur a Vantage model charge. */
export function resolveCadMetering(brainMode: CadBrainMode): CadMeterResolution {
  const described = describeCadBrainMode(brainMode);
  switch (brainMode) {
    case "terminal_cli":
      return { keySource: "local_cli", costUsd: 0, billing: described.billing };
    case "mock":
      return { keySource: "local", costUsd: 0, billing: described.billing };
    case "team_byok":
      return { keySource: "byo", costUsd: 0, billing: described.billing };
    case "managed_api":
      return { keySource: "platform", costUsd: 0, billing: described.billing };
  }
}

function assertAllowlistedPlan(actions: CadAction[]) {
  if (actions.length > 50) throw new Error("CAD action plan exceeds the 50-step complexity limit");
  for (const action of actions) {
    if (!isAllowlistedCadOperation(action.operation)) {
      throw new Error(`CAD operation is not allowlisted: ${action.operation}`);
    }
    if (action.operation.startsWith("export_") || canAutoRunWithinAllowlist(action.operation, true)) {
      continue;
    }
    if (!action.requiresApproval && requiresDestructiveConfirmation(action.operation)) {
      throw new Error(`Geometry mutation requires approval: ${action.operation}`);
    }
  }
}

class InlineMockAdapter implements LoopCadAdapter {
  readonly platform = "mock" as const;
  readonly executionMode = "hosted" as const;
  private version = 0;
  async execute(action: CadAction, context: { jobId: string; idempotencyKey: string }) {
    this.version++;
    const fingerprint = createHash("sha256")
      .update(`${context.jobId}:${this.version}:${action.operation}:${JSON.stringify(action.parameters)}`)
      .digest("hex");
    return {
      externalFeatureId: `mock-feature-${this.version}`,
      output: { operation: action.operation, deterministic: true },
      topology: { fingerprint, summary: { bodies: 1, features: this.version, validation: "mock-pass" } },
      render: {
        mimeType: "image/svg+xml",
        content: `<svg xmlns="http://www.w3.org/2000/svg"><text>${action.operation}</text></svg>`,
      },
      checkpointRef: `mock-checkpoint-${this.version}`,
    };
  }
}

export type AgentLoopStepRecord = {
  sequence: number;
  operation: CadOperation;
  requiresApproval: boolean;
  approvalStatus: "approved" | "rejected" | "auto";
  status: "completed" | "rejected" | "failed";
  result?: CadExecutionResult;
  error?: string;
};

export type MockCadAgentLoopResult = {
  planningPrompt: string;
  sanitizedRequest: string;
  brief: EngineeringBriefLite;
  plan: CadAction[];
  steps: AgentLoopStepRecord[];
  metering: CadMeterResolution;
  totalVantageCostUsd: number;
  finalFingerprint: string | null;
};

export type RunMockCadAgentLoopInput = {
  request: string;
  adapter?: LoopCadAdapter;
  brainMode?: CadBrainMode;
  /** When true, approve every step that requires approval (CI fixture). */
  autoApprove?: boolean;
  autoRunVerify?: boolean;
  jobId?: string;
};

/**
 * End-to-end mock agent loop: untrusted brief → allowlisted plan → approvals → adapter execute → verify.
 * Does not call live Autodesk, Onshape, or managed model APIs.
 */
export async function runMockCadAgentLoop(input: RunMockCadAgentLoopInput): Promise<MockCadAgentLoopResult> {
  const brainMode = input.brainMode ?? "mock";
  const metering = resolveCadMetering(brainMode);
  const sanitizedRequest = sanitizeUntrustedCadText(input.request);
  const planningPrompt = cadenceAgentPlanningPrompt(input.request);
  const brief: EngineeringBriefLite = {
    summary: input.request.trim() || "Untitled mechanism",
    assumptions: [{ name: "Envelope dimensions", value: "12 in", needsConfirmation: false }],
  };
  const plan = buildDefaultCadPlan(brief, { autoRunVerify: input.autoRunVerify ?? true });
  assertAllowlistedPlan(plan);

  const adapter = input.adapter ?? new InlineMockAdapter();
  const jobId =
    input.jobId ?? `mock-job-${createHash("sha256").update(input.request).digest("hex").slice(0, 12)}`;
  const steps: AgentLoopStepRecord[] = [];
  let finalFingerprint: string | null = null;
  const autoApprove = input.autoApprove !== false;

  for (const [index, action] of plan.entries()) {
    const sequence = index + 1;
    const autoEligible = canAutoRunWithinAllowlist(action.operation, Boolean(input.autoRunVerify));
    let approvalStatus: AgentLoopStepRecord["approvalStatus"] = autoEligible ? "auto" : "approved";

    if (action.requiresApproval && !autoEligible && !autoApprove) {
      steps.push({
        sequence,
        operation: action.operation,
        requiresApproval: true,
        approvalStatus: "rejected",
        status: "rejected",
        error: "Human approval required",
      });
      continue;
    }

    if (action.requiresApproval && !autoEligible) {
      approvalStatus = "approved";
    }

    try {
      const result = await adapter.execute(action, {
        jobId,
        idempotencyKey: `${jobId}:${sequence}:${action.operation}`,
      });
      finalFingerprint = result.topology.fingerprint;
      steps.push({
        sequence,
        operation: action.operation,
        requiresApproval: action.requiresApproval,
        approvalStatus,
        status: "completed",
        result,
      });
    } catch (error) {
      steps.push({
        sequence,
        operation: action.operation,
        requiresApproval: action.requiresApproval,
        approvalStatus,
        status: "failed",
        error: error instanceof Error ? error.message : "Step failed",
      });
      break;
    }
  }

  return {
    planningPrompt,
    sanitizedRequest,
    brief,
    plan,
    steps,
    metering,
    totalVantageCostUsd: metering.costUsd,
    finalFingerprint,
  };
}

/** Stub Onshape transport for hosted-path contract tests (no OAuth). */
export function createOnshapeStubTransport(): {
  mutate(input: {
    operation: CadOperation;
    parameters: Record<string, unknown>;
    idempotencyKey: string;
  }): Promise<{ featureId?: string }>;
  describe(): Promise<{
    fingerprint: string;
    summary: Record<string, unknown>;
    render: string;
    checkpointRef: string;
  }>;
  rollback(checkpointRef: string): Promise<void>;
} {
  let version = 0;
  return {
    async mutate(input) {
      version++;
      return { featureId: `onshape-stub-${input.operation}-${version}` };
    },
    async describe() {
      const fingerprint = createHash("sha256").update(`onshape-stub:${version}`).digest("hex");
      return {
        fingerprint,
        summary: { bodies: 1, features: version, validation: "onshape-stub-pass" },
        render: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 40"><text y="24">Onshape stub ${version}</text></svg>`,
        checkpointRef: `onshape-stub-cp-${version}`,
      };
    },
    async rollback() {
      version = Math.max(0, version - 1);
    },
  };
}

/** Loop-facing Onshape stub adapter (no live OAuth). */
export function createOnshapeStubAdapter(): LoopCadAdapter {
  const transport = createOnshapeStubTransport();
  return {
    platform: "onshape",
    executionMode: "hosted",
    async execute(action, context) {
      const mutation = await transport.mutate({
        operation: action.operation,
        parameters: action.parameters,
        idempotencyKey: context.idempotencyKey,
      });
      const verified = await transport.describe();
      return {
        externalFeatureId: mutation.featureId,
        output: { operation: action.operation, onshapeStub: true },
        topology: { fingerprint: verified.fingerprint, summary: verified.summary },
        render: { mimeType: "image/svg+xml", content: verified.render },
        checkpointRef: verified.checkpointRef,
      };
    },
  };
}

/**
 * Drive a signed Fusion relay envelope through the mock plugin handler (no Autodesk).
 */
export async function executeViaMockFusionPlugin(input?: {
  secret?: string;
  operation?: CadAction;
}): Promise<CadExecutionResult> {
  const secret = input?.secret ?? "test-secret";
  const handler = createMockFusionPluginHandler(secret);
  const unsigned = buildTestFusionEnvelope({
    operation: input?.operation ?? {
      operation: "create_extrude",
      parameters: { depth: "25 mm" },
      requiresApproval: true,
      reason: "mock fusion execute",
    },
  });
  const signed = signFusionRelayJob(
    (({ signature: _s, ...rest }: FusionRelayEnvelope) => {
      void _s;
      return rest;
    })(unsigned),
    secret,
  );
  if (!verifyFusionRelayJob(signed, secret)) throw new Error("Failed to sign mock Fusion envelope");

  const chunks: Buffer[] = [];
  const res = {
    writeHead() {},
    end(body: string) {
      chunks.push(Buffer.from(body));
    },
  } as unknown as ServerResponse;
  const req = {
    method: "POST",
    url: "/execute",
    on(event: string, cb: (arg?: Buffer) => void) {
      if (event === "data") cb(Buffer.from(JSON.stringify(signed)));
      if (event === "end") cb();
    },
  } as unknown as IncomingMessage;
  await handler(req, res);
  const payload = JSON.parse(Buffer.concat(chunks).toString("utf8")) as CadExecutionResult & {
    error?: string;
  };
  if (!payload.topology?.fingerprint) {
    throw new Error(payload.error ?? "Mock Fusion plugin did not return topology");
  }
  return payload;
}

export type { FusionRelayEnvelope };
