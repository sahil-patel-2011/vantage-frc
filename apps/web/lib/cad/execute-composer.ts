/**
 * Run a serialized CadOperationComposer step against POST /api/cad.
 *
 * New geometry uses the hosted job pipeline (confirm → append-step → approve →
 * execute-onshape). An existing Onshape featureId updates that feature instead.
 * Feature IDs are never invented. FeatureScript is never sent.
 */

import { isComposerNativeOp, type ComposerNativeOp } from "./composer-ops";
import { hasEntityListPicks } from "./remember-feature";

export type ComposerDocumentRef = {
  documentId?: string;
  workspaceId?: string;
  elementId?: string;
};

export type ExecuteComposerInput = {
  orgId: string;
  payload: Record<string, unknown>;
  documentRef?: ComposerDocumentRef | null;
  /** Existing cad_jobs row. Looked up from GET /api/cad when omitted. */
  jobId?: string | null;
  /** FeatureId Onshape already returned. Never pass DEMO or a guessed id. */
  featureId?: string | null;
};

export type ExecuteComposerResult = {
  action: "execute-onshape" | "update-onshape-feature";
  jobId?: string;
  stepId?: string;
  featureId?: string;
  result: Record<string, unknown>;
};

const DEMO_FEATURE_ID = /demo/i;
const CAD_AGENT_JOB_TITLE = "CAD agent";

type SerializedOp = {
  operation: ComposerNativeOp;
  parameters: Record<string, unknown>;
  reason: string;
};

type CadJobRow = {
  id: string;
  title?: string;
  platform?: string;
  brief?: unknown;
  briefConfirmedAt?: unknown;
};

export async function executeComposerOp(input: ExecuteComposerInput): Promise<ExecuteComposerResult> {
  const orgId = String(input.orgId ?? "").trim();
  if (!orgId) throw new Error("orgId is required");

  const op = parseSerializedComposerOp(input.payload);
  const documentRef = completeDocumentRef(input.documentRef);
  // New entity picks always create. A leftover featureId from a prior step
  // must not silently update that feature.
  const featureId =
    op.operation === "delete_feature" || hasEntityListPicks(op.parameters)
      ? undefined
      : existingFeatureId(input.featureId, input.payload, op.parameters);

  if (featureId) {
    if (!documentRef && !String(input.jobId ?? "").trim()) {
      throw new Error("Bind an Onshape document/workspace/element first");
    }
    const result = await postCad({
      action: "update-onshape-feature",
      orgId,
      featureId,
      ...(String(input.jobId ?? "").trim() ? { jobId: String(input.jobId).trim() } : {}),
      ...(documentRef ? { documentRef } : {}),
      ...dimensionPatch(op.parameters),
    });
    return { action: "update-onshape-feature", featureId, jobId: optionalId(input.jobId), result };
  }

  const job = await resolveOnshapeJob(orgId, input.jobId);
  if (!documentRef && !job) {
    throw new Error("Bind an Onshape document before running a native operation");
  }
  if (!job) {
    throw new Error("Bind an Onshape document before running a native operation");
  }

  if (!job.briefConfirmedAt) {
    await postCad({
      action: "confirm",
      orgId,
      jobId: job.id,
      brief: job.brief ?? composerBrief(op),
    });
  }

  if (documentRef) {
    await postCad({
      action: "set-document",
      orgId,
      jobId: job.id,
      documentRef,
    });
  }

  const appended = await postCad({
    action: "append-step",
    orgId,
    jobId: job.id,
    operation: op.operation,
    parameters: op.parameters,
    reason: op.reason || "Human-reviewed native Onshape operation",
  });
  const stepId = String(appended.id ?? "").trim();
  if (!stepId) throw new Error("CAD step was not created");

  await postCad({
    action: "approve",
    orgId,
    jobId: job.id,
    stepId,
    approved: true,
  });

  const result = await postCad({
    action: "execute-onshape",
    orgId,
    jobId: job.id,
    stepId,
  });

  return {
    action: "execute-onshape",
    jobId: job.id,
    stepId,
    featureId: returnedFeatureId(result),
    result,
  };
}

export function parseSerializedComposerOp(payload: unknown): SerializedOp {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new Error("Choose a native Onshape operation");
  }
  const record = payload as Record<string, unknown>;
  const operation = String(record.operation ?? "").trim();
  if (operation === "feature_script") {
    throw new Error("FeatureScript is not allowed from the native operation composer");
  }
  if (!isComposerNativeOp(operation)) {
    throw new Error("Choose a native Onshape operation");
  }
  const parameters = asParamRecord(record.parameters);
  if (typeof parameters.source === "string" && parameters.source.trim()) {
    throw new Error("FeatureScript is not allowed from the native operation composer");
  }
  return {
    operation,
    parameters,
    reason: String(record.reason ?? "").trim(),
  };
}

/** Only an id the caller already has. Empty stays empty; DEMO is refused. */
export function existingFeatureId(...candidates: unknown[]): string | undefined {
  for (const candidate of candidates) {
    const fromRecord =
      candidate && typeof candidate === "object" && !Array.isArray(candidate)
        ? (candidate as Record<string, unknown>).featureId
        : candidate;
    const id = typeof fromRecord === "string" ? fromRecord.trim() : "";
    if (!id) continue;
    if (DEMO_FEATURE_ID.test(id)) {
      throw new Error("Refusing DEMO feature id. Pass the featureId Onshape returned from a prior create.");
    }
    if (candidate && typeof candidate === "object" && !Array.isArray(candidate)) {
      const record = candidate as Record<string, unknown>;
      if (hasEntityListPicks(record) || hasEntityListPicks(asParamRecord(record.parameters))) {
        continue;
      }
    }
    return id;
  }
  return undefined;
}

function asParamRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function completeDocumentRef(ref: ComposerDocumentRef | null | undefined): ComposerDocumentRef | null {
  const documentId = String(ref?.documentId ?? "").trim();
  const workspaceId = String(ref?.workspaceId ?? "").trim();
  const elementId = String(ref?.elementId ?? "").trim();
  if (!documentId || !workspaceId || !elementId) return null;
  return { documentId, workspaceId, elementId };
}

function dimensionPatch(parameters: Record<string, unknown>): Record<string, number> {
  const patch: Record<string, number> = {};
  for (const key of ["depthMm", "widthMm", "heightMm", "radiusMm", "diameterMm", "thicknessMm"] as const) {
    const value = parameters[key];
    if (typeof value === "number" && Number.isFinite(value)) patch[key] = value;
  }
  return patch;
}

function composerBrief(op: SerializedOp): Record<string, unknown> {
  const summary = op.reason || `Run ${op.operation}`;
  return {
    summary,
    requirements: [],
    constraints: [],
    scoringTasks: [],
    assumptions: [],
    risks: [],
    acceptanceCriteria: [],
    sourceRefs: [],
    disclaimer: "",
  };
}

async function resolveOnshapeJob(orgId: string, jobId?: string | null): Promise<CadJobRow | null> {
  const data = await getCad(orgId);
  const jobs = Array.isArray(data.jobs) ? (data.jobs as CadJobRow[]) : [];
  const explicit = String(jobId ?? "").trim();
  if (explicit) {
    return jobs.find((job) => job.id === explicit && job.platform === "onshape") ?? { id: explicit, platform: "onshape" };
  }
  const onshape = jobs.filter((job) => job.platform === "onshape" && String(job.id ?? "").trim());
  return onshape.find((job) => job.title === CAD_AGENT_JOB_TITLE) ?? onshape[0] ?? null;
}

async function getCad(orgId: string): Promise<Record<string, unknown>> {
  const response = await fetch(`/api/cad?orgId=${encodeURIComponent(orgId)}`);
  return readCadResponse(response);
}

async function postCad(body: Record<string, unknown>): Promise<Record<string, unknown>> {
  const response = await fetch("/api/cad", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return readCadResponse(response);
}

async function readCadResponse(response: Response): Promise<Record<string, unknown>> {
  const data = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (!response.ok) {
    const message =
      (typeof data.error === "string" && data.error.trim()) ||
      (typeof data.message === "string" && data.message.trim()) ||
      "CAD request failed";
    throw new Error(message);
  }
  return data;
}

function optionalId(value: unknown): string | undefined {
  const id = String(value ?? "").trim();
  return id || undefined;
}

function returnedFeatureId(result: Record<string, unknown>): string | undefined {
  const direct = existingFeatureId(result.featureId, result.externalFeatureId);
  if (direct) return direct;
  const output = asParamRecord(result.output);
  return existingFeatureId(output.featureId, result.externalFeatureId);
}
