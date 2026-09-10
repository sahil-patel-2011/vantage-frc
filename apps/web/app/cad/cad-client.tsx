"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { resolveCutoffErrorCode } from "../../components/usage-cutoff-banner";
import { withOrgHref } from "../../lib/nav/product-nav";
import { executeComposerOp } from "../../lib/cad/execute-composer";
import {
  parseExplainFeatures,
  type DeleteFeaturePayload,
  type ExplainedFeature,
  type UpdateFeaturePayload,
} from "../../lib/cad/feature-tree";
import {
  EMPTY_LISTED_ASSEMBLY,
  listOnshapeAssemblyInstances,
  type ListedOnshapeAssembly,
} from "../../lib/cad/list-assembly";
import {
  EMPTY_LISTED_ELEMENTS,
  documentTabKind,
  listDocumentElements,
  type ListedDocumentElements,
} from "../../lib/cad/list-document-elements";
import {
  EMPTY_LISTED_ENTITIES,
  completeDocumentRef,
  listOnshapeEntities,
  type ListedOnshapeEntities,
} from "../../lib/cad/list-entities";
import {
  EMPTY_LISTED_VARIABLES,
  listOnshapeVariables,
  type ListedOnshapeVariables,
} from "../../lib/cad/list-variables";
import { rememberComposerFeature } from "../../lib/cad/remember-feature";
import {
  parametersForExecute,
  rememberLastSketchFeatureId,
  runComposerPlan,
} from "../../lib/cad/run-composer-plan";
import type { ComposerOp } from "../../lib/cad/composer-ops";
import {
  type AgentMode,
  type AgentState,
  type BoundDoc,
  type ChatResponse,
  type PlanStep,
} from "./cad-model";
import {
  asParamRecord,
  checkpointIdFromExecute,
  onshapeTabUrl,
  readStoredAssemblyElementId,
  readStoredVariableStudioElementId,
  realReturnedId,
  rememberLastAssemblyElementId,
  rememberLastInstanceIds,
  withLastAssemblyElementId,
  withLastInstanceIds,
  withVariableStudio,
  writeStoredAssemblyElementId,
  writeStoredVariableStudioElementId,
} from "./cad-session";
import { CadReadyView } from "./cad-ready-view";
import { type CadToolRow } from "./cad-tools-panel";
import "./cad-agent.css";
import "./cad-setup.css";
import "./cad-activity.css";

export type { CadToolRow } from "./cad-tools-panel";

export default function CadWorkspace({
  orgId,
  tools = [],
  embedded: _embedded = false,
}: {
  orgId: string;
  tools?: CadToolRow[];
  embedded?: boolean;
}) {
  const [url, setUrl] = useState("");
  const [state, setState] = useState<AgentState | null>(null);
  const [prompt, setPrompt] = useState("");
  const [busy, setBusy] = useState<"load" | "bind" | "chat" | "mode" | null>("load");
  const [error, setError] = useState("");
  // Kept apart from bind/chat errors so an expired session offers sign-in, not a Retry that cannot work.
  const [loadFailure, setLoadFailure] = useState<{ status: number | null; message: string } | null>(null);
  const [cutoffCode, setCutoffCode] = useState<string | null>(null);
  // The mode-switch proposal card: 15-second countdown; No or expiry keeps the current mode.
  const [pendingProposal, setPendingProposal] = useState<{
    mode: AgentMode;
    reasons: string[];
    expiresAt: string;
    message: string;
  } | null>(null);
  const [countdown, setCountdown] = useState(15);
  const [planSteps, setPlanSteps] = useState<PlanStep[]>([]);
  const [planAnswers, setPlanAnswers] = useState<string[]>([]);
  const [listedEntities, setListedEntities] = useState<ListedOnshapeEntities>(EMPTY_LISTED_ENTITIES);
  const [explainedFeatures, setExplainedFeatures] = useState<ExplainedFeature[]>([]);
  const [listedVariables, setListedVariables] = useState<ListedOnshapeVariables>(EMPTY_LISTED_VARIABLES);
  const [listedAssembly, setListedAssembly] = useState<ListedOnshapeAssembly>(EMPTY_LISTED_ASSEMBLY);
  const [listedElements, setListedElements] = useState<ListedDocumentElements>(EMPTY_LISTED_ELEMENTS);
  const [lastCheckpointId, setLastCheckpointId] = useState<string | null>(null);
  const [geometryError, setGeometryError] = useState("");
  const answeringRef = useRef(false);
  const logRef = useRef<HTMLDivElement>(null);
  const lastSketchFeatureId = useRef<string | undefined>(undefined);
  const lastAssemblyElementId = useRef<string | undefined>(undefined);
  const lastVariableStudioElementId = useRef<string | undefined>(undefined);
  const lastInstanceIds = useRef<string[]>([]);
  const [workingTabId, setWorkingTabId] = useState("");

  const load = useCallback(async () => {
    const response = await fetch(`/api/cad/agent?orgId=${encodeURIComponent(orgId)}`);
    const data = (await response.json()) as AgentState & { error?: string };
    if (!response.ok) {
      const failure = { status: response.status, message: data.error ?? "Could not load CAD agent" };
      setLoadFailure(failure);
      throw new Error(failure.message);
    }
    setLoadFailure(null);
    setState(data);
    if (data.bound?.url) setUrl(data.bound.url);
    const stored = readStoredAssemblyElementId(orgId, data.bound?.documentId ?? "");
    if (stored) lastAssemblyElementId.current = stored;
    const storedStudio = readStoredVariableStudioElementId(orgId, data.bound?.documentId ?? "");
    if (storedStudio) lastVariableStudioElementId.current = storedStudio;
    if (data.bound?.elementId) setWorkingTabId(data.bound.elementId);
    return data;
  }, [orgId]);

  const runLoad = useCallback(() => {
    setBusy("load");
    return load()
      .catch((err) => {
        setLoadFailure(
          (prev) =>
            prev ?? {
              status: null,
              message: err instanceof Error ? err.message : "Could not load CAD agent",
            },
        );
      })
      .finally(() => {
        setBusy(null);
      });
  }, [load]);

  useEffect(() => {
    let cancelled = false;
    setBusy("load");
    void load()
      .catch((err) => {
        if (cancelled) return;
        setLoadFailure(
          (prev) =>
            prev ?? {
              status: null,
              message: err instanceof Error ? err.message : "Could not load CAD agent",
            },
        );
      })
      .finally(() => {
        if (!cancelled) setBusy(null);
      });
    return () => {
      cancelled = true;
    };
  }, [load]);

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight });
  }, [state?.messages, busy]);

  const boundDocumentId = state?.bound?.documentId;
  const boundWorkspaceId = state?.bound?.workspaceId;
  const boundElementId = state?.bound?.elementId;

  useEffect(() => {
    lastAssemblyElementId.current = readStoredAssemblyElementId(orgId, boundDocumentId ?? "");
  }, [orgId, boundDocumentId]);

  const refreshBoundGeometry = useCallback(async () => {
    if (boundDocumentId && !lastAssemblyElementId.current) {
      const stored = readStoredAssemblyElementId(orgId, boundDocumentId);
      if (stored) lastAssemblyElementId.current = stored;
    }
    if (boundDocumentId && !lastVariableStudioElementId.current) {
      const storedStudio = readStoredVariableStudioElementId(orgId, boundDocumentId);
      if (storedStudio) lastVariableStudioElementId.current = storedStudio;
    }
    const documentRef = completeDocumentRef({
      documentId: boundDocumentId,
      workspaceId: boundWorkspaceId,
      elementId: boundElementId,
    });
    if (!documentRef) {
      setListedEntities(EMPTY_LISTED_ENTITIES);
      setExplainedFeatures([]);
      setListedVariables(EMPTY_LISTED_VARIABLES);
      setListedAssembly(EMPTY_LISTED_ASSEMBLY);
      setGeometryError("");
      return;
    }
    try {
      setListedEntities(await listOnshapeEntities({ orgId, documentRef }));
      setGeometryError("");
    } catch {
      setListedEntities(EMPTY_LISTED_ENTITIES);
      setGeometryError("Could not list Onshape entities. Bind a Part Studio and retry.");
    }
    try {
      setListedVariables(
        await listOnshapeVariables({
          orgId,
          documentRef,
          variableStudioElementId: lastVariableStudioElementId.current || undefined,
        }),
      );
    } catch {
      setListedVariables(EMPTY_LISTED_VARIABLES);
    }
    try {
      setListedAssembly(
        await listOnshapeAssemblyInstances({
          orgId,
          documentRef,
          assemblyElementId: lastAssemblyElementId.current || undefined,
        }),
      );
    } catch {
      setListedAssembly(EMPTY_LISTED_ASSEMBLY);
    }
    try {
      const response = await fetch("/api/cad", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "explain-onshape-features", orgId, documentRef }),
      });
      const data = (await response.json().catch(() => ({}))) as unknown;
      if (!response.ok) {
        setExplainedFeatures([]);
        return;
      }
      setExplainedFeatures(parseExplainFeatures(data));
    } catch {
      setExplainedFeatures([]);
    }
  }, [orgId, boundDocumentId, boundWorkspaceId, boundElementId]);

  useEffect(() => {
    void refreshBoundGeometry();
  }, [refreshBoundGeometry]);

  useEffect(() => {
    if (!boundDocumentId || !boundWorkspaceId) {
      setListedElements(EMPTY_LISTED_ELEMENTS);
      return;
    }
    let cancelled = false;
    void listDocumentElements({ orgId, documentId: boundDocumentId, workspaceId: boundWorkspaceId })
      .then((listed) => {
        if (!cancelled) setListedElements(listed);
      })
      .catch(() => {
        // Keep URL paste bind if list-onshape-elements fails — never crash or invent tabs.
        if (!cancelled) setListedElements(EMPTY_LISTED_ELEMENTS);
      });
    return () => {
      cancelled = true;
    };
  }, [orgId, boundDocumentId, boundWorkspaceId]);

  const modeState = state?.modeState ?? null;
  const mode: AgentMode = modeState?.mode ?? "simple";
  const plan = useMemo(
    () => (modeState?.plan && !modeState.plan.approved ? modeState.plan : null),
    [modeState?.plan],
  );

  // A reload while a proposal is live re-renders the card from the stored
  // proposedAt/expiresAt; the server also treats anything older than 15s as declined.
  useEffect(() => {
    const stored = modeState?.proposal;
    if (stored && !pendingProposal) {
      setPendingProposal({ mode: stored.mode, reasons: [], expiresAt: stored.expiresAt, message: "" });
    }
  }, [modeState?.proposal, pendingProposal]);

  // Editable copies of the pending plan's steps and answers.
  useEffect(() => {
    if (plan) {
      setPlanSteps(plan.steps.map((step) => ({ ...step })));
      setPlanAnswers(plan.questions.map((_, index) => plan.answers[index] ?? ""));
    } else {
      setPlanSteps([]);
      setPlanAnswers([]);
    }
  }, [plan]);

  function applyChatResponse(data: ChatResponse) {
    setState((prev) =>
      prev
        ? {
            ...prev,
            messages: data.messages ?? prev.messages,
            steps: data.steps ?? prev.steps,
            modeState: data.modeState !== undefined ? data.modeState : prev.modeState,
            shadedPngBase64: data.shadedPngBase64 ?? prev.shadedPngBase64,
          }
        : prev,
    );
  }

  function applyShadedPng(png: unknown) {
    if (typeof png === "string" && png.trim()) {
      setState((prev) => (prev ? { ...prev, shadedPngBase64: png } : prev));
    }
  }

  async function bind() {
    setBusy("bind");
    setError("");
    try {
      const response = await fetch("/api/cad/agent", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "bind", orgId, url }),
      });
      const data = (await response.json()) as {
        error?: string;
        bound?: BoundDoc;
        iframeUrl?: string;
        openUrl?: string;
        shadedPngBase64?: string | null;
      };
      if (!response.ok) throw new Error(data.error ?? "Bind failed");
      setState((prev) =>
        prev
          ? {
              ...prev,
              bound: data.bound ?? prev.bound,
              iframeUrl: null,
              openUrl: data.openUrl ?? prev.openUrl,
              shadedPngBase64: data.shadedPngBase64 ?? prev.shadedPngBase64,
            }
          : prev,
      );
      if (data.bound?.url) setUrl(data.bound.url);
      if (data.bound?.elementId) setWorkingTabId(data.bound.elementId);
      const stored = readStoredAssemblyElementId(orgId, data.bound?.documentId ?? "");
      if (stored) lastAssemblyElementId.current = stored;
      const storedStudio = readStoredVariableStudioElementId(orgId, data.bound?.documentId ?? "");
      if (storedStudio) lastVariableStudioElementId.current = storedStudio;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Bind failed");
    } finally {
      setBusy(null);
    }
  }

  async function bindDocumentRef(documentRef: { documentId: string; workspaceId: string; elementId: string }) {
    const documentId = realReturnedId(documentRef.documentId);
    const workspaceId = realReturnedId(documentRef.workspaceId);
    const elementId = realReturnedId(documentRef.elementId);
    if (!documentId || !workspaceId || !elementId) return;
    const nextUrl = onshapeTabUrl(documentId, workspaceId, elementId);
    setUrl(nextUrl);
    setBusy("bind");
    setError("");
    try {
      const response = await fetch("/api/cad/agent", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "bind", orgId, url: nextUrl }),
      });
      const data = (await response.json()) as {
        error?: string;
        bound?: BoundDoc;
        iframeUrl?: string;
        openUrl?: string;
        shadedPngBase64?: string | null;
      };
      if (!response.ok) throw new Error(data.error ?? "Bind failed");
      setState((prev) =>
        prev
          ? {
              ...prev,
              bound: data.bound ?? prev.bound,
              iframeUrl: null,
              openUrl: data.openUrl ?? prev.openUrl,
              shadedPngBase64: data.shadedPngBase64 ?? prev.shadedPngBase64,
            }
          : prev,
      );
      if (data.bound?.url) setUrl(data.bound.url);
      if (data.bound?.elementId) setWorkingTabId(data.bound.elementId);
      const stored = readStoredAssemblyElementId(orgId, data.bound?.documentId ?? documentId);
      if (stored) lastAssemblyElementId.current = stored;
      const storedStudio = readStoredVariableStudioElementId(orgId, data.bound?.documentId ?? documentId);
      if (storedStudio) lastVariableStudioElementId.current = storedStudio;
      try {
        const jobsResponse = await fetch(`/api/cad?orgId=${encodeURIComponent(orgId)}`);
        const jobsData = (await jobsResponse.json().catch(() => ({}))) as {
          jobs?: Array<{ id?: string; title?: string; platform?: string }>;
        };
        const jobs = Array.isArray(jobsData.jobs) ? jobsData.jobs : [];
        const job =
          jobs.find((row) => row.platform === "onshape" && row.title === "CAD agent" && realReturnedId(row.id)) ??
          jobs.find((row) => row.platform === "onshape" && realReturnedId(row.id));
        const jobId = realReturnedId(job?.id);
        if (jobId) {
          await fetch("/api/cad", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              action: "set-document",
              orgId,
              jobId,
              documentRef: { documentId, workspaceId, elementId },
            }),
          });
        }
      } catch {
        // Agent bind already updated the tab; job set-document is best-effort.
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Bind failed");
    } finally {
      setBusy(null);
    }
  }

  async function switchBoundElement(elementId: string) {
    const listed = listedElements.elements.find((element) => element.id === realReturnedId(elementId));
    const documentId = realReturnedId(state?.bound?.documentId);
    const workspaceId = realReturnedId(state?.bound?.workspaceId);
    if (!listed || !documentId || !workspaceId) return;
    const kind = documentTabKind(listed.type, listed.elementType);
    setWorkingTabId(listed.id);
    if (kind === "assembly") {
      lastAssemblyElementId.current = listed.id;
      writeStoredAssemblyElementId(orgId, documentId, listed.id);
      await refreshBoundGeometry();
      return;
    }
    if (kind === "variablestudio") {
      lastVariableStudioElementId.current = listed.id;
      writeStoredVariableStudioElementId(orgId, documentId, listed.id);
      await refreshBoundGeometry();
      return;
    }
    await bindDocumentRef({ documentId, workspaceId, elementId: listed.id });
  }

  async function setModeManual(next: AgentMode) {
    if (next === mode) return;
    setBusy("mode");
    setError("");
    setPendingProposal(null);
    answeringRef.current = false;
    try {
      const response = await fetch("/api/cad/agent", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "set-mode", orgId, mode: next }),
      });
      const data = (await response.json()) as { error?: string; modeState?: AgentState["modeState"] };
      if (!response.ok) throw new Error(data.error ?? "Mode switch failed");
      setState((prev) => (prev ? { ...prev, modeState: data.modeState ?? prev.modeState } : prev));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Mode switch failed");
    } finally {
      setBusy(null);
    }
  }

  async function send() {
    const message = prompt.trim();
    if (!message) return;
    setBusy("chat");
    setError("");
    setCutoffCode(null);
    setPrompt("");
    setState((prev) =>
      prev ? { ...prev, messages: [...prev.messages, { role: "user", text: message }] } : prev,
    );
    try {
      const response = await fetch("/api/cad/agent", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "chat", orgId, message }),
      });
      const data = (await response.json()) as ChatResponse;
      if (!response.ok) {
        setCutoffCode(resolveCutoffErrorCode(response.status, data));
        throw new Error(data.error ?? "CAD agent failed");
      }
      if (data.proposal) {
        // The turn is held for consent; the brief is kept locally and re-sent
        // with the Yes/No answer (or when the countdown runs out).
        answeringRef.current = false;
        setPendingProposal({ ...data.proposal, message });
        applyChatResponse({ modeState: data.modeState });
        return;
      }
      applyChatResponse(data);
      await load().catch(() => undefined);
      void refreshBoundGeometry();
    } catch (err) {
      setError(err instanceof Error ? err.message : "CAD agent failed");
    } finally {
      setBusy(null);
    }
  }

  const respondProposal = useCallback(
    async (accept: boolean) => {
      if (answeringRef.current || !pendingProposal) return;
      answeringRef.current = true;
      const held = pendingProposal;
      setPendingProposal(null);
      setBusy(held.message ? "chat" : "mode");
      setError("");
      setCutoffCode(null);
      try {
        const response = await fetch("/api/cad/agent", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ action: "propose-response", orgId, accept, message: held.message }),
        });
        const data = (await response.json()) as ChatResponse;
        if (!response.ok) {
          setCutoffCode(resolveCutoffErrorCode(response.status, data));
          throw new Error(data.error ?? "CAD agent failed");
        }
        applyChatResponse(data);
        if (held.message) await load().catch(() => undefined);
        void refreshBoundGeometry();
      } catch (err) {
        setError(err instanceof Error ? err.message : "CAD agent failed");
      } finally {
        setBusy(null);
      }
    },
    [orgId, pendingProposal, load, refreshBoundGeometry],
  );

  // 15-second countdown; expiry counts as No and the agent continues in the current mode.
  useEffect(() => {
    if (!pendingProposal) return;
    const tick = () => {
      const remain = Math.max(0, Math.ceil((new Date(pendingProposal.expiresAt).getTime() - Date.now()) / 1000));
      setCountdown(remain);
      if (remain <= 0) void respondProposal(false);
    };
    tick();
    const id = setInterval(tick, 250);
    return () => clearInterval(id);
  }, [pendingProposal, respondProposal]);

  async function approvePlan() {
    if (!plan) return;
    setBusy("chat");
    setError("");
    setCutoffCode(null);
    try {
      const response = await fetch("/api/cad/agent", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "chat",
          orgId,
          message: "",
          planResponse: {
            approve: true,
            steps: planSteps.map((step) => ({ title: step.title, detail: step.detail })),
            answers: planAnswers,
          },
        }),
      });
      const data = (await response.json()) as ChatResponse;
      if (!response.ok) {
        setCutoffCode(resolveCutoffErrorCode(response.status, data));
        throw new Error(data.error ?? "CAD agent failed");
      }
      applyChatResponse(data);
      await load().catch(() => undefined);
      void refreshBoundGeometry();
    } catch (err) {
      setError(err instanceof Error ? err.message : "CAD agent failed");
    } finally {
      setBusy(null);
    }
  }

  const onshapeOk = Boolean(state?.onshapeConnected);
  const boundOk = Boolean(state?.bound?.documentId);
  const connectionsHref = withOrgHref("/cad/connections", orgId);
  const tasks = mode === "multitask" ? modeState?.tasks ?? null : null;

  const composerHint = !onshapeOk
    ? "Connect Onshape first"
    : mode === "plan"
      ? "Plan mode: the agent plans and asks before building"
      : mode === "multitask"
        ? "Multitask mode: sub-tasks run one at a time"
        : "Ctrl+Enter to send";

  async function onAppendComposer(payload: Record<string, unknown>) {
    const operation = String(payload.operation ?? "");
    const parameters = withLastInstanceIds(
      operation,
      withLastAssemblyElementId(
        operation,
        parametersForExecute(
          { ...payload, operation, parameters: asParamRecord(payload.parameters) } as ComposerOp,
          lastSketchFeatureId.current,
        ),
        lastAssemblyElementId.current,
      ),
      lastInstanceIds.current,
    );
    const executed = await executeComposerOp({
      orgId,
      payload: withVariableStudio(
        { ...payload, parameters },
        lastVariableStudioElementId.current || listedVariables.variableStudioElementId,
      ),
      documentRef: state?.bound ?? null,
    });
    applyShadedPng(executed.result.shadedPngBase64);
    lastSketchFeatureId.current = rememberLastSketchFeatureId(
      operation,
      executed.featureId,
      lastSketchFeatureId.current,
    );
    lastAssemblyElementId.current = rememberLastAssemblyElementId(
      operation,
      executed,
      lastAssemblyElementId.current,
    );
    writeStoredAssemblyElementId(orgId, state?.bound?.documentId ?? "", lastAssemblyElementId.current);
    lastInstanceIds.current = rememberLastInstanceIds(
      operation,
      executed,
      lastInstanceIds.current,
    );
    const checkpointId = checkpointIdFromExecute(executed);
    if (checkpointId) setLastCheckpointId(checkpointId);
    rememberComposerFeature({ parameters }, executed);
    void refreshBoundGeometry();
    return executed;
  }

  async function onRunComposerPlan(ops: unknown) {
    const ran = await runComposerPlan(ops, async (step) => {
      const parameters = withLastInstanceIds(
        step.operation,
        withLastAssemblyElementId(
          step.operation,
          parametersForExecute(step, lastSketchFeatureId.current),
          lastAssemblyElementId.current,
        ),
        lastInstanceIds.current,
      );
      const executed = await executeComposerOp({
        orgId,
        payload: withVariableStudio(
          {
            operation: step.operation,
            parameters,
            reason: step.reason,
          },
          lastVariableStudioElementId.current || listedVariables.variableStudioElementId,
        ),
        documentRef: state?.bound ?? null,
      });
      applyShadedPng(executed.result.shadedPngBase64);
      rememberComposerFeature(step, executed);
      lastSketchFeatureId.current = rememberLastSketchFeatureId(
        step.operation,
        executed.featureId,
        lastSketchFeatureId.current,
      );
      lastAssemblyElementId.current = rememberLastAssemblyElementId(
        step.operation,
        executed,
        lastAssemblyElementId.current,
      );
      writeStoredAssemblyElementId(orgId, state?.bound?.documentId ?? "", lastAssemblyElementId.current);
      lastInstanceIds.current = rememberLastInstanceIds(
        step.operation,
        executed,
        lastInstanceIds.current,
      );
      const checkpointId = checkpointIdFromExecute(executed);
      if (checkpointId) setLastCheckpointId(checkpointId);
      return executed;
    });
    void refreshBoundGeometry();
    return ran;
  }

  async function onDeleteFeature(payload: DeleteFeaturePayload) {
    try {
      await executeComposerOp({
        orgId,
        payload: {
          operation: "delete_feature",
          parameters: { featureId: payload.featureId },
          reason: "Delete native feature",
        },
        documentRef: state?.bound ?? null,
      });
      void refreshBoundGeometry();
    } catch (err) {
      const message = err instanceof Error ? err.message : "Could not delete feature";
      setError(message);
      throw err;
    }
  }

  async function onUpdateFeature(payload: UpdateFeaturePayload) {
    const documentRef = completeDocumentRef(state?.bound ?? null);
    if (!documentRef) {
      throw new Error("Bind an Onshape document/workspace/element first");
    }
    const response = await fetch("/api/cad", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...payload, orgId, documentRef }),
    });
    const data = (await response.json().catch(() => ({}))) as {
      error?: string;
      message?: string;
      shadedPngBase64?: string | null;
    };
    if (!response.ok) {
      throw new Error(
        (typeof data.error === "string" && data.error.trim()) ||
          (typeof data.message === "string" && data.message.trim()) ||
          "CAD request failed",
      );
    }
    applyShadedPng(data.shadedPngBase64);
    void refreshBoundGeometry();
    return data;
  }

  async function onSetVariable(payload: {
    name: string;
    expression: string;
    variableStudioElementId?: string;
  }) {
    const studioId =
      payload.variableStudioElementId ||
      lastVariableStudioElementId.current ||
      listedVariables.variableStudioElementId;
    await executeComposerOp({
      orgId,
      payload: {
        operation: "set_variable",
        parameters: {
          name: payload.name,
          expression: payload.expression,
          ...(studioId ? { variableStudioElementId: studioId } : {}),
        },
        reason: `Update variable ${payload.name}`,
      },
      documentRef: state?.bound ?? null,
    });
    void refreshBoundGeometry();
  }

  return (
    <CadReadyView
      orgId={orgId}
      tools={tools}
      cutoffCode={cutoffCode}
      url={url}
      setUrl={setUrl}
      bind={bind}
      busy={busy}
      listedElements={listedElements}
      workingTabId={workingTabId}
      boundElementId={boundElementId}
      switchBoundElement={switchBoundElement}
      state={state}
      boundOk={boundOk}
      onshapeOk={onshapeOk}
      loadFailure={loadFailure}
      error={error}
      setLoadFailure={setLoadFailure}
      runLoad={runLoad}
      mode={mode}
      setModeManual={setModeManual}
      connectionsHref={connectionsHref}
      logRef={logRef}
      pendingProposal={pendingProposal}
      countdown={countdown}
      respondProposal={respondProposal}
      plan={plan}
      planSteps={planSteps}
      setPlanSteps={setPlanSteps}
      planAnswers={planAnswers}
      setPlanAnswers={setPlanAnswers}
      approvePlan={approvePlan}
      tasks={tasks}
      prompt={prompt}
      setPrompt={setPrompt}
      send={send}
      composerHint={composerHint}
      geometryError={geometryError}
      refreshBoundGeometry={refreshBoundGeometry}
      lastCheckpointId={lastCheckpointId}
      listedEntities={listedEntities}
      explainedFeatures={explainedFeatures}
      listedAssembly={listedAssembly}
      listedVariables={listedVariables}
      lastVariableStudioElementId={lastVariableStudioElementId}
      onAppendComposer={onAppendComposer}
      onRunComposerPlan={onRunComposerPlan}
      onDeleteFeature={onDeleteFeature}
      onUpdateFeature={onUpdateFeature}
      onSetVariable={onSetVariable}
    />
  );
}
