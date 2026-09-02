"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { UsageCutoffBanner, resolveCutoffErrorCode } from "../../components/usage-cutoff-banner";
import { withOrgHref } from "../../lib/nav/product-nav";
import { classifyLoadFailure, loadFailureCopy } from "../../lib/ui/load-failure";
import { CadAdaptivePanel, type CadAdaptiveView } from "./cad-adaptive-panel";
import { CadPlanReview, CadPlanRun, type PlanDecision, type PlanRunStep } from "./cad-plan-review";
import { CadVaultPanel } from "./cad-vault-panel";
import "./cad-agent.css";
import "./cad-setup.css";
import "./cad-activity.css";

type BoundDoc = {
  documentId?: string;
  workspaceId?: string;
  elementId?: string;
  documentName?: string | null;
  url?: string | null;
};

type ChatMessage = { role: "user" | "assistant" | "tool"; text: string };

type AgentMode = "simple" | "plan" | "multitask";

type PlanStep = {
  index: number;
  title: string;
  detail: string;
  tool?: string;
  args?: Record<string, unknown>;
  dryRun?: string;
  sequence?: number;
};

type AgentPlan = {
  planId: string;
  brief: string;
  steps: PlanStep[];
  questions: string[];
  answers: string[];
  approved: boolean;
};

type AgentStep = {
  index: number;
  tool: string;
  label: string;
  title: string;
  detail: string;
  status: "done" | "failed";
  featureId: string | null;
  at: string;
};

type AgentTask = {
  id: string;
  title: string;
  status: "pending" | "in_progress" | "done" | "failed";
  note: string;
};

type ModeState = {
  mode: AgentMode;
  proposal: { mode: AgentMode; proposedAt: string; expiresAt: string } | null;
  plan: AgentPlan | null;
  /** Per-step outcome of the approved plan, from cad_job_steps. */
  planRun?: PlanRunStep[] | null;
  tasks: AgentTask[] | null;
};

type AgentState = {
  onshapeConfigured: boolean;
  onshapeConnected: boolean;
  onshapeVia?: "oauth" | "team_oauth" | "api_key" | null;
  bound: BoundDoc | null;
  iframeUrl: string | null;
  /** Shaded-view PNG endpoint for the bound Part Studio, or null when unbound / unconnected. */
  viewUrl: string | null;
  openUrl: string | null;
  messages: ChatMessage[];
  /** Narrated build steps for this session, newest turn last. */
  steps?: AgentStep[];
  modeState?: ModeState | null;
};

type ChatResponse = {
  error?: string;
  code?: string;
  text?: string;
  tools?: Array<{ name: string; ok: boolean }>;
  messages?: ChatMessage[];
  steps?: AgentStep[];
  modeState?: ModeState | null;
  proposal?: { mode: AgentMode; reasons: string[]; expiresAt: string } | null;
};

const MODE_LABELS: Record<AgentMode, string> = { simple: "Simple", plan: "Plan", multitask: "Multitask" };

type ActivityRow = {
  id: string;
  source: "terminal" | "web";
  title: string;
  platform: string;
  status: string;
  documentName: string | null;
  documentUrl: string | null;
  machineName: string | null;
  authorName: string | null;
  mine: boolean;
  toolCallCount: number;
  lastTool: string | null;
  updatedAt: string;
};

type ActivityDetailStep = {
  index: number;
  tool: string;
  title: string;
  detail: string;
  status: "done" | "failed";
  at: string;
};

type ActivityDetail = {
  id: string;
  source: "terminal" | "web";
  status: string;
  documentName: string | null;
  documentUrl: string | null;
  steps: ActivityDetailStep[];
  emptyReason: string | null;
};

const ACTIVITY_SOURCE_LABELS: Record<ActivityRow["source"], string> = {
  terminal: "Terminal",
  web: "Web agent",
};

type ActivityScope = "all" | "mine";
type ActivitySource = "all" | "web" | "terminal";

const SCOPE_OPTIONS: Array<{ value: ActivityScope; label: string }> = [
  { value: "all", label: "Everyone" },
  { value: "mine", label: "Mine" },
];

const SOURCE_OPTIONS: Array<{ value: ActivitySource; label: string }> = [
  { value: "all", label: "All" },
  { value: "web", label: "Web" },
  { value: "terminal", label: "Terminal" },
];

function activityRelativeTime(iso: string): string {
  const then = Date.parse(iso);
  if (!Number.isFinite(then)) return "";
  const minutes = Math.round((Date.now() - then) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

/** Web agent sessions and vantage-cad terminal sessions in one newest-first list. */
function CadActivityPanel({ orgId }: { orgId: string }) {
  const [rows, setRows] = useState<ActivityRow[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [scope, setScope] = useState<ActivityScope>("all");
  const [source, setSource] = useState<ActivitySource>("all");
  // One row expanded at a time; details are fetched on demand, not with the list.
  const [openId, setOpenId] = useState<string | null>(null);
  const [details, setDetails] = useState<Record<string, ActivityDetail | "loading" | "failed">>({});

  const loadActivity = useCallback(async () => {
    setRefreshing(true);
    try {
      const query = new URLSearchParams({ orgId, scope, source });
      const response = await fetch(`/api/cad/activity?${query.toString()}`);
      const data = (await response.json()) as { activity?: ActivityRow[]; error?: string };
      if (!response.ok) throw new Error(data.error ?? "Could not load CAD activity");
      setRows(data.activity ?? []);
      setFailed(false);
    } catch {
      setFailed(true);
    } finally {
      setRefreshing(false);
    }
  }, [orgId, scope, source]);

  useEffect(() => {
    void loadActivity();
  }, [loadActivity]);

  const toggleDetail = useCallback(
    async (id: string) => {
      if (openId === id) {
        setOpenId(null);
        return;
      }
      setOpenId(id);
      // Re-fetch a row that previously failed; keep a good result cached.
      if (details[id] && details[id] !== "failed") return;
      setDetails((prev) => ({ ...prev, [id]: "loading" }));
      try {
        const query = new URLSearchParams({ orgId, sessionId: id });
        const response = await fetch(`/api/cad/activity?${query.toString()}`);
        const data = (await response.json()) as { detail?: ActivityDetail; error?: string };
        if (!response.ok || !data.detail) throw new Error(data.error ?? "Could not load this session");
        setDetails((prev) => ({ ...prev, [id]: data.detail! }));
      } catch {
        setDetails((prev) => ({ ...prev, [id]: "failed" }));
      }
    },
    [details, openId, orgId],
  );

  const filtered = scope === "mine" || source !== "all";

  return (
    <section className="cad-activity" aria-label="Recent CAD activity">
      <div className="cad-activity-head">
        <span>Recent CAD activity</span>
        <div className="cad-activity-filters">
          <div className="cad-activity-filter" role="group" aria-label="Whose sessions">
            {SCOPE_OPTIONS.map((option) => (
              <button
                key={option.value}
                type="button"
                className={`cad-activity-chip${scope === option.value ? " active" : ""}`}
                aria-pressed={scope === option.value}
                onClick={() => setScope(option.value)}
              >
                {option.label}
              </button>
            ))}
          </div>
          <div className="cad-activity-filter" role="group" aria-label="Session source">
            {SOURCE_OPTIONS.map((option) => (
              <button
                key={option.value}
                type="button"
                className={`cad-activity-chip${source === option.value ? " active" : ""}`}
                aria-pressed={source === option.value}
                onClick={() => setSource(option.value)}
              >
                {option.label}
              </button>
            ))}
          </div>
          <button
            type="button"
            className="app-button secondary"
            disabled={refreshing}
            onClick={() => void loadActivity()}
          >
            {refreshing ? "Refreshing…" : "Refresh"}
          </button>
        </div>
      </div>
      {failed ? (
        <p className="cad-activity-error">Could not load CAD activity right now. Refresh to retry.</p>
      ) : rows === null ? (
        <p className="cad-activity-empty">Loading activity…</p>
      ) : rows.length === 0 ? (
        <p className="cad-activity-empty">
          {filtered ? (
            <>No CAD sessions match this filter. Switch to Everyone / All to see the rest.</>
          ) : (
            <>
              No CAD activity yet. Web agent sessions from this page and terminal sessions from{" "}
              <code>vantage-cad</code> (Claude Code) will appear here once someone sketches or extrudes.
            </>
          )}
        </p>
      ) : (
        <ul className="cad-activity-list">
          {rows.map((row) => {
            const detail = details[row.id];
            const open = openId === row.id;
            return (
              <li key={row.id} className="cad-activity-item">
                <button
                  type="button"
                  className="cad-activity-row"
                  aria-expanded={open}
                  onClick={() => void toggleDetail(row.id)}
                >
                  <span className={`cad-activity-source cad-activity-source--${row.source}`}>
                    {ACTIVITY_SOURCE_LABELS[row.source]}
                  </span>
                  <span className="cad-activity-title">
                    {row.documentName ? `${row.title} — ${row.documentName}` : row.title}
                  </span>
                  <span className="cad-activity-meta">
                    {row.platform}
                    {row.mine ? " · you" : row.authorName ? ` · ${row.authorName}` : ""}
                    {row.source === "terminal" && row.machineName ? ` · ${row.machineName}` : ""}
                    {row.toolCallCount > 0
                      ? ` · ${row.toolCallCount} step${row.toolCallCount === 1 ? "" : "s"}${
                          row.lastTool ? ` (last: ${row.lastTool})` : ""
                        }`
                      : ""}
                    {row.updatedAt ? ` · ${activityRelativeTime(row.updatedAt)}` : ""}
                  </span>
                  {row.status === "failed" ? <span className="cad-activity-status--failed">Failed</span> : null}
                  <span aria-hidden="true" className="cad-activity-caret">
                    {open ? "▾" : "▸"}
                  </span>
                </button>
                {open ? (
                  <div className="cad-activity-detail">
                    {detail === "loading" || detail === undefined ? (
                      <p className="cad-activity-empty">Loading session…</p>
                    ) : detail === "failed" ? (
                      <p className="cad-activity-error">
                        Could not load this session. Collapse and reopen to retry.
                      </p>
                    ) : (
                      <>
                        {detail.documentUrl ? (
                          <a
                            className="cad-activity-open"
                            href={detail.documentUrl}
                            target="_blank"
                            rel="noreferrer"
                          >
                            Open in Onshape
                          </a>
                        ) : null}
                        {detail.steps.length ? (
                          <ol className="cad-step-list">
                            {detail.steps.map((step) => (
                              <li key={`${detail.id}-${step.index}`} className={`cad-step cad-step--${step.status}`}>
                                <span className="cad-step-index">{step.index}</span>
                                <span className="cad-step-body">
                                  <span className="cad-step-title">{step.title}</span>
                                  {step.detail ? <span className="cad-step-detail">{step.detail}</span> : null}
                                </span>
                                <span className="cad-step-status">
                                  {step.status === "failed" ? "Failed" : "Done"}
                                </span>
                              </li>
                            ))}
                          </ol>
                        ) : (
                          <p className="cad-activity-empty">{detail.emptyReason}</p>
                        )}
                      </>
                    )}
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}


export type CadToolRow = {
  name: string;
  label: string;
  group: string;
  description: string;
  onshape: "supported" | "unsupported";
  fusion: "supported" | "unsupported";
  fusionOperation: string | null;
  fusionNote: string | null;
  mutating: boolean;
};

const TOOL_GROUP_LABELS: Record<string, string> = {
  session: "Session",
  sketch: "Sketch",
  solid: "Solid",
  modify: "Modify",
  pattern: "Pattern",
  inspect: "Inspect",
  export: "Export",
};

/**
 * What the agent can and cannot do, stated BEFORE anyone asks for it.
 *
 * The point of this panel is the "Onshape only" badge: the Fusion add-in
 * implements eight operations, and a CAD lead should read that here rather than
 * discover it when a fillet fails three steps into a build. `fusionNote` also
 * carries the partial cases (Fusion fillets every edge; Onshape can do corners
 * only), which are shown on supported tools too.
 */
function CadToolsPanel({ tools }: { tools: CadToolRow[] }) {
  const [open, setOpen] = useState(false);
  const groups = useMemo(() => {
    const byGroup = new Map<string, CadToolRow[]>();
    for (const tool of tools) {
      const list = byGroup.get(tool.group) ?? [];
      list.push(tool);
      byGroup.set(tool.group, list);
    }
    return [...byGroup.entries()];
  }, [tools]);

  if (!tools.length) return null;

  return (
    <section className="cad-activity cad-tools" aria-label="CAD tools">
      <div className="cad-activity-head">
        <span>Tools — {tools.length} operations</span>
        <button type="button" className="app-button secondary" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
          {open ? "Hide tools" : "Show tools"}
        </button>
      </div>
      {open ? (
        <div className="cad-tools-body">
          <p className="cad-activity-empty">
            This page runs the Onshape half. Fusion 360 needs the local VantageCadRelay add-in on your PC, so tools
            marked <b>Onshape only</b> cannot run here or from a Fusion session.
          </p>
          {groups.map(([group, list]) => (
            <div key={group} className="cad-tools-group">
              <h3>{TOOL_GROUP_LABELS[group] ?? group}</h3>
              <ul>
                {list.map((tool) => (
                  <li key={tool.name} className="cad-tool">
                    <span className="cad-tool-head">
                      <code>{tool.name}</code>
                      {tool.onshape === "supported" && tool.fusion === "unsupported" ? (
                        <span className="cad-tool-badge cad-tool-badge--onshape">Onshape only</span>
                      ) : null}
                      {tool.onshape === "unsupported" && tool.fusion === "supported" ? (
                        <span className="cad-tool-badge cad-tool-badge--fusion">Fusion only</span>
                      ) : null}
                    </span>
                    <span className="cad-tool-desc">{tool.description}</span>
                    {tool.fusionNote ? <span className="cad-tool-note">Fusion: {tool.fusionNote}</span> : null}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      ) : null}
    </section>
  );
}

/**
 * The narrated build log for the current session. Each line is the tool's own
 * wording ("Drilled 4× ⌀5 mm through holes"), so a student can read what was
 * built without opening Onshape.
 */
function CadStepPane({ steps }: { steps: AgentStep[] }) {
  if (!steps.length) return null;
  const failed = steps.filter((step) => step.status === "failed").length;
  return (
    <div className="cad-step-panel">
      <b>
        Build steps — {steps.length} step{steps.length === 1 ? "" : "s"}
        {failed ? `, ${failed} failed` : ""}
      </b>
      <ol className="cad-step-list">
        {steps.map((step) => (
          <li key={`step-${step.index}`} className={`cad-step cad-step--${step.status}`}>
            <span className="cad-step-index">{step.index}</span>
            <span className="cad-step-body">
              <span className="cad-step-title">{step.title}</span>
              {step.detail ? <span className="cad-step-detail">{step.detail}</span> : null}
            </span>
            <span className="cad-step-status">{step.status === "failed" ? "Failed" : "Done"}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}

const TASK_STATUS_LABELS: Record<AgentTask["status"], string> = {
  pending: "Pending",
  in_progress: "In progress",
  done: "Done",
  failed: "Failed",
};

type ViewState =
  | { kind: "idle" }
  | { kind: "loading"; src: string | null }
  | { kind: "ready"; src: string; at: string }
  | { kind: "unbound" }
  | { kind: "setup_required"; message: string }
  | { kind: "error"; message: string; src: string | null };

/**
 * The viewport: a server-fetched shaded-view PNG of the bound Part Studio
 * (Onshape refuses to be framed). Fetched — not an <img src> — so a 404 / 503 /
 * 502 from /api/cad/agent/view can be shown as its own honest state instead of
 * a broken-image icon. Refreshed after every executed tool call and on demand.
 */
function useCadViewport(viewUrl: string | null) {
  const [view, setView] = useState<ViewState>({ kind: "idle" });
  const objectUrl = useRef<string | null>(null);
  const inflight = useRef(0);

  const refresh = useCallback(async () => {
    if (!viewUrl) {
      setView({ kind: "unbound" });
      return;
    }
    const token = ++inflight.current;
    setView((prev) => ({ kind: "loading", src: prev.kind === "ready" || prev.kind === "error" ? prev.src : null }));
    try {
      const response = await fetch(`${viewUrl}&t=${Date.now()}`, { cache: "no-store" });
      if (token !== inflight.current) return;
      if (!response.ok) {
        const data = (await response.json().catch(() => ({}))) as { error?: string; code?: string };
        if (response.status === 404) setView({ kind: "unbound" });
        else if (response.status === 503) setView({ kind: "setup_required", message: data.error ?? "Connect Onshape to render the viewport." });
        else setView((prev) => ({ kind: "error", message: data.error ?? `Render failed (HTTP ${response.status})`, src: prev.kind === "loading" ? prev.src : null }));
        return;
      }
      const blob = await response.blob();
      if (token !== inflight.current) return;
      const next = URL.createObjectURL(blob);
      if (objectUrl.current) URL.revokeObjectURL(objectUrl.current);
      objectUrl.current = next;
      setView({ kind: "ready", src: next, at: new Date().toLocaleTimeString() });
    } catch (error) {
      if (token !== inflight.current) return;
      setView((prev) => ({
        kind: "error",
        message: error instanceof Error ? error.message : "Could not load the viewport",
        src: prev.kind === "loading" ? prev.src : null,
      }));
    }
  }, [viewUrl]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(
    () => () => {
      if (objectUrl.current) URL.revokeObjectURL(objectUrl.current);
    },
    [],
  );

  return { view, refresh };
}

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
  const [busy, setBusy] = useState<"load" | "bind" | "chat" | "mode" | "plan" | null>("load");
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
  // Legacy (narrative-only) plans are still edited inline and executed by the model.
  const [planSteps, setPlanSteps] = useState<PlanStep[]>([]);
  const [planAnswers, setPlanAnswers] = useState<string[]>([]);
  const [planRunning, setPlanRunning] = useState(false);
  const [sidePanel, setSidePanel] = useState<"viewport" | "files">("viewport");
  const [vaultRefresh, setVaultRefresh] = useState(0);
  const [adaptive, setAdaptive] = useState<CadAdaptiveView | null>(null);
  const answeringRef = useRef(false);
  const logRef = useRef<HTMLDivElement>(null);

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

  // Team standards + private copilot preferences (the adaptive panel); optional, never blocks the agent.
  useEffect(() => {
    let cancelled = false;
    void fetch(`/api/cad?orgId=${encodeURIComponent(orgId)}`)
      .then(async (response) => {
        const data = (await response.json()) as { adaptive?: CadAdaptiveView };
        if (!cancelled && response.ok && data.adaptive) setAdaptive(data.adaptive);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [orgId]);

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight });
  }, [state?.messages, busy]);

  const { view, refresh: refreshView } = useCadViewport(state?.viewUrl ?? null);

  const modeState = state?.modeState ?? null;
  const mode: AgentMode = modeState?.mode ?? "simple";
  const plan = useMemo(
    () => (modeState?.plan && !modeState.plan.approved ? modeState.plan : null),
    [modeState?.plan],
  );
  const planHasTools = Boolean(plan?.steps.some((step) => step.tool && step.sequence));
  const planRun = modeState?.plan?.approved && modeState.planRun?.length ? modeState.planRun : null;

  // A reload while a proposal is live re-renders the card from the stored
  // proposedAt/expiresAt; the server also treats anything older than 15s as declined.
  useEffect(() => {
    const stored = modeState?.proposal;
    if (stored && !pendingProposal) {
      setPendingProposal({ mode: stored.mode, reasons: [], expiresAt: stored.expiresAt, message: "" });
    }
  }, [modeState?.proposal, pendingProposal]);

  // Editable copies of a legacy plan's steps and answers.
  useEffect(() => {
    if (plan && !planHasTools) {
      setPlanSteps(plan.steps.map((step) => ({ ...step })));
      setPlanAnswers(plan.questions.map((_, index) => plan.answers[index] ?? ""));
    } else {
      setPlanSteps([]);
      setPlanAnswers([]);
    }
  }, [plan, planHasTools]);

  function applyChatResponse(data: ChatResponse) {
    setState((prev) =>
      prev
        ? {
            ...prev,
            messages: data.messages ?? prev.messages,
            steps: data.steps ?? prev.steps,
            modeState: data.modeState !== undefined ? data.modeState : prev.modeState,
          }
        : prev,
    );
  }

  /** After anything that may have changed geometry or saved a file. */
  const afterBuild = useCallback(async () => {
    setVaultRefresh((value) => value + 1);
    await refreshView();
  }, [refreshView]);

  async function bind() {
    setBusy("bind");
    setError("");
    try {
      const response = await fetch("/api/cad/agent", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "bind", orgId, url }),
      });
      const data = (await response.json()) as { error?: string; bound?: BoundDoc; viewUrl?: string | null; openUrl?: string };
      if (!response.ok) throw new Error(data.error ?? "Bind failed");
      setState((prev) =>
        prev
          ? {
              ...prev,
              bound: data.bound ?? prev.bound,
              viewUrl: data.viewUrl ?? null,
              openUrl: data.openUrl ?? prev.openUrl,
            }
          : prev,
      );
      if (data.bound?.url) setUrl(data.bound.url);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Bind failed");
    } finally {
      setBusy(null);
    }
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
      const data = (await response.json()) as { error?: string; modeState?: ModeState };
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
      if (data.tools?.length) await afterBuild();
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
        if (held.message) {
          await load().catch(() => undefined);
          if (data.tools?.length) await afterBuild();
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "CAD agent failed");
      } finally {
        setBusy(null);
      }
    },
    [orgId, pendingProposal, load, afterBuild],
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

  /** Legacy narrative plans: the model executes them (kept for plans created before tool-call plans). */
  async function approveLegacyPlan() {
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
      await afterBuild();
    } catch (err) {
      setError(err instanceof Error ? err.message : "CAD agent failed");
    } finally {
      setBusy(null);
    }
  }

  /**
   * Run approved steps one request at a time so each step's status lands on
   * screen and the viewport refreshes between them. Stops at the first failure;
   * "Continue" / "Retry step" resume from the run panel.
   */
  const runPlanSteps = useCallback(
    async (sequences: number[]) => {
      if (!sequences.length) return;
      setPlanRunning(true);
      setError("");
      setCutoffCode(null);
      try {
        for (const sequence of sequences) {
          const response = await fetch("/api/cad/agent", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ action: "execute-plan-step", orgId, sequence }),
          });
          const data = (await response.json()) as ChatResponse & { step?: PlanRunStep; done?: boolean };
          if (!response.ok) {
            setCutoffCode(resolveCutoffErrorCode(response.status, data));
            throw new Error(data.error ?? "Plan step failed");
          }
          applyChatResponse(data);
          await afterBuild();
          if (data.step && data.step.status !== "completed") {
            setError(`Stopped at step ${data.step.index}: ${data.step.error ?? "the tool did not complete"}. Fix the plan or retry the step.`);
            break;
          }
          if (data.done) break;
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "Plan step failed");
      } finally {
        setPlanRunning(false);
      }
    },
    [orgId, afterBuild],
  );

  const approvePlan = useCallback(
    async (decisions: PlanDecision[], answers: string[]) => {
      if (!plan) return;
      setBusy("plan");
      setError("");
      try {
        const response = await fetch("/api/cad/agent", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ action: "approve-plan", orgId, planId: plan.planId, decisions, answers }),
        });
        const data = (await response.json()) as { error?: string; modeState?: ModeState };
        if (!response.ok) throw new Error(data.error ?? "Could not approve the plan");
        setState((prev) => (prev ? { ...prev, modeState: data.modeState ?? prev.modeState } : prev));
        const run = data.modeState?.planRun ?? [];
        const sequences = run.filter((step) => step.approvalStatus === "approved" && step.status === "planned").map((step) => step.sequence);
        setBusy(null);
        await runPlanSteps(sequences);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Could not approve the plan");
        setBusy(null);
      }
    },
    [orgId, plan, runPlanSteps],
  );

  const discardPlan = useCallback(async () => {
    setBusy("plan");
    setError("");
    try {
      const response = await fetch("/api/cad/agent", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "discard-plan", orgId }),
      });
      const data = (await response.json()) as { error?: string; modeState?: ModeState };
      if (!response.ok) throw new Error(data.error ?? "Could not discard the plan");
      setState((prev) => (prev ? { ...prev, modeState: data.modeState ?? prev.modeState } : prev));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not discard the plan");
    } finally {
      setBusy(null);
    }
  }, [orgId]);

  const continuePlan = useCallback(async () => {
    const sequences = (planRun ?? [])
      .filter((step) => step.approvalStatus === "approved" && step.status === "planned")
      .map((step) => step.sequence);
    await runPlanSteps(sequences);
  }, [planRun, runPlanSteps]);

  const retryPlanStep = useCallback(
    async (sequence: number) => {
      const rest = (planRun ?? [])
        .filter((step) => step.sequence > sequence && step.approvalStatus === "approved" && step.status === "planned")
        .map((step) => step.sequence);
      await runPlanSteps([sequence, ...rest]);
    },
    [planRun, runPlanSteps],
  );

  const saveAdaptive = useCallback(
    async (action: string, payload: Record<string, unknown>) => {
      setError("");
      try {
        const response = await fetch("/api/cad", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ orgId, action, ...payload }),
        });
        const data = (await response.json()) as { error?: string };
        if (!response.ok) throw new Error(data.error ?? "Could not save CAD preferences");
        const reload = await fetch(`/api/cad?orgId=${encodeURIComponent(orgId)}`);
        const next = (await reload.json()) as { adaptive?: CadAdaptiveView };
        if (reload.ok && next.adaptive) setAdaptive(next.adaptive);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Could not save CAD preferences");
      }
    },
    [orgId],
  );

  const onshapeOk = Boolean(state?.onshapeConnected || state?.onshapeConfigured);
  const boundOk = Boolean(state?.bound?.documentId);
  const connectionsHref = withOrgHref("/cad/connections", orgId);
  const tasks = mode === "multitask" ? modeState?.tasks ?? null : null;
  const anyBusy = busy !== null || planRunning;

  const composerHint = !onshapeOk
    ? "Connect Onshape first"
    : planRunning
      ? "Plan steps are running — wait for them to finish"
      : mode === "plan"
        ? "Plan mode: the agent proposes tool calls and you approve before anything runs"
        : mode === "multitask"
          ? "Multitask mode: sub-tasks run one at a time"
          : "Ctrl+Enter to send";

  return (
    <main className="module-page cad-module cad-agent">
      {cutoffCode ? <UsageCutoffBanner orgId={orgId} errorCode={cutoffCode} compact /> : null}

      <header className="cad-agent-bar">
        <div className="cad-agent-brand">CAD</div>
        <label className="cad-agent-doc">
          <span>Onshape document URL</span>
          <input
            value={url}
            onChange={(event) => setUrl(event.target.value)}
            placeholder="https://cad.onshape.com/documents/…"
            onKeyDown={(event) => {
              if (event.key === "Enter") void bind();
            }}
          />
        </label>
        <button className="app-button" type="button" disabled={!url.trim() || anyBusy} onClick={() => void bind()}>
          {busy === "bind" ? "Binding…" : "Bind"}
        </button>
        <div className="cad-agent-leds">
          <span className={state?.onshapeConnected ? "on" : ""} title={state?.onshapeVia ? `via ${state.onshapeVia.replace("_", " ")}` : undefined}>
            {state?.onshapeConnected
              ? state.onshapeVia === "team_oauth"
                ? "Onshape connected (team)"
                : state.onshapeVia === "api_key"
                  ? "Onshape connected (server keys)"
                  : "Onshape connected"
              : "Onshape off"}
          </span>
          {/* Name the bound document, not just "bound" — the first thing to check
              before an agent edits geometry is that it is the right Part Studio. */}
          <span className={boundOk ? "on" : ""} title={state?.bound?.documentId ?? undefined}>
            {boundOk ? state?.bound?.documentName || "Part Studio bound" : "Not bound"}
          </span>
          {state?.openUrl ? (
            <a className="cad-agent-open" href={state.openUrl} target="_blank" rel="noreferrer">
              Open in Onshape
            </a>
          ) : null}
        </div>
      </header>

      {!state && loadFailure ? (
        (() => {
          const copy = loadFailureCopy(
            classifyLoadFailure({
              status: loadFailure.status,
              message: loadFailure.message,
              online: typeof navigator === "undefined" ? true : navigator.onLine,
            }),
            {
              nextPath:
                typeof window === "undefined"
                  ? null
                  : `${window.location.pathname}${window.location.search}`,
              message: loadFailure.message,
            },
          );
          return (
            <p className="cad-agent-error" role="alert">
              <strong>{copy.title}</strong> {copy.description}{" "}
              {copy.primary ? (
                <a className="app-button" href={copy.primary.href}>
                  {copy.primary.label}
                </a>
              ) : null}
              {copy.showRetry ? (
                <button
                  type="button"
                  className="app-button secondary"
                  disabled={busy !== null}
                  onClick={() => {
                    setLoadFailure(null);
                    void runLoad();
                  }}
                >
                  Retry
                </button>
              ) : null}
            </p>
          );
        })()
      ) : error ? (
        <p className="cad-agent-error" role="alert">
          {error}
        </p>
      ) : null}

      <div className="cad-agent-workspace">
        <aside className="cad-agent-chat">
          <div className="cad-agent-col-head">
            Agent
            <div className="cad-mode-switch" role="group" aria-label="Agent mode">
              {(["simple", "plan", "multitask"] as const).map((option) => (
                <button
                  key={option}
                  type="button"
                  className={`cad-mode-btn${mode === option ? " active" : ""}`}
                  aria-pressed={mode === option}
                  disabled={anyBusy}
                  onClick={() => void setModeManual(option)}
                >
                  {MODE_LABELS[option]}
                </button>
              ))}
            </div>
          </div>
          {state && !state.onshapeConnected ? (
            <div className="cad-agent-setup">
              <p>Connect Onshape, bind a disposable Part Studio, then specify the part in millimetres.</p>
              <a className="app-button" href={connectionsHref}>
                Connect Onshape
              </a>
              {!state?.onshapeConfigured ? (
                <p className="cad-agent-hint">
                  Server setup still required: set <code>ONSHAPE_OAUTH_CLIENT_ID</code> and{" "}
                  <code>ONSHAPE_OAUTH_CLIENT_SECRET</code> (or <code>ONSHAPE_ACCESS_KEY</code> /{" "}
                  <code>ONSHAPE_SECRET_KEY</code>). Until then this page will not invent geometry.
                </p>
              ) : (
                <p className="cad-agent-hint">An owner or admin can also share their connection with the whole team from Connections.</p>
              )}
            </div>
          ) : null}
          <div className="cad-agent-log" ref={logRef}>
            {!state?.messages.length ? (
              <div className="cad-agent-hero">
                Specify the part in millimetres. Bind the Onshape Part Studio, then send a brief. The agent sketches and
                extrudes live — this is not a mock job.
                {mode === "plan"
                  ? " Plan mode: the agent proposes the exact tool calls with a dry run of each; you approve all or some before anything touches Onshape."
                  : mode === "multitask"
                    ? " Multitask mode: the brief is split into a checklist of sub-tasks worked one at a time."
                    : ""}
              </div>
            ) : (
              state.messages.map((item, index) => (
                <article key={`${item.role}-${index}`} className={`cad-agent-msg cad-agent-msg--${item.role}`}>
                  <b>{item.role === "user" ? "You" : item.role === "tool" ? "Tool" : "Agent"}</b>
                  <p>{item.text}</p>
                </article>
              ))
            )}

            {pendingProposal ? (
              <div className="cad-proposal-card" role="alert">
                <b>Switch to {MODE_LABELS[pendingProposal.mode]} mode?</b>
                <p>
                  {pendingProposal.reasons.length
                    ? pendingProposal.reasons.join(" ")
                    : "The agent thinks another mode fits this brief better."}
                </p>
                <p className="cad-proposal-count" aria-live="polite">
                  Continuing in {MODE_LABELS[mode]} mode in {countdown}s unless you choose.
                </p>
                <div className="cad-proposal-actions">
                  <button className="app-button" type="button" disabled={anyBusy} onClick={() => void respondProposal(true)}>
                    Yes, switch
                  </button>
                  <button
                    className="app-button secondary"
                    type="button"
                    disabled={anyBusy}
                    onClick={() => void respondProposal(false)}
                  >
                    No, stay in {MODE_LABELS[mode]}
                  </button>
                </div>
              </div>
            ) : null}

            {plan && planHasTools ? (
              <CadPlanReview
                steps={plan.steps}
                questions={plan.questions}
                answers={plan.answers}
                busy={anyBusy}
                onApprove={approvePlan}
                onDiscard={discardPlan}
              />
            ) : null}

            {plan && !planHasTools ? (
              <div className="cad-plan-panel">
                <b>Build plan — review before anything runs in Onshape</b>
                <ol className="cad-plan-steps">
                  {planSteps.map((step, index) => (
                    <li key={`plan-step-${index}`}>
                      <input
                        value={step.title}
                        aria-label={`Step ${index + 1}`}
                        onChange={(event) =>
                          setPlanSteps((prev) =>
                            prev.map((item, i) => (i === index ? { ...item, title: event.target.value } : item)),
                          )
                        }
                      />
                      {step.detail ? <span className="cad-plan-detail">{step.detail}</span> : null}
                    </li>
                  ))}
                </ol>
                {plan.questions.length ? (
                  <div className="cad-plan-questions">
                    <b>Questions from the agent</b>
                    {plan.questions.map((question, index) => (
                      <label key={`plan-q-${index}`}>
                        <span>{question}</span>
                        <input
                          value={planAnswers[index] ?? ""}
                          placeholder="Answer in mm where relevant"
                          onChange={(event) =>
                            setPlanAnswers((prev) => prev.map((item, i) => (i === index ? event.target.value : item)))
                          }
                        />
                      </label>
                    ))}
                  </div>
                ) : null}
                <div className="cad-plan-actions">
                  <button className="app-button" type="button" disabled={anyBusy} onClick={() => void approveLegacyPlan()}>
                    Approve &amp; build
                  </button>
                  <span className="cad-agent-hint">Or send a message below to revise the plan.</span>
                </div>
              </div>
            ) : null}

            {planRun ? (
              <CadPlanRun
                run={planRun}
                running={planRunning}
                busy={anyBusy}
                onContinue={continuePlan}
                onRetry={retryPlanStep}
                onClear={discardPlan}
              />
            ) : null}

            {tasks?.length ? (
              <div className="cad-task-list">
                <b>Sub-task checklist</b>
                <ul>
                  {tasks.map((task) => (
                    <li key={task.id} className={`cad-task cad-task--${task.status}`}>
                      <span className="cad-task-status">{TASK_STATUS_LABELS[task.status]}</span>
                      <span className="cad-task-title">{task.title}</span>
                      {task.note ? <span className="cad-task-note">{task.note}</span> : null}
                    </li>
                  ))}
                </ul>
                <p className="cad-agent-hint">
                  Sub-tasks run one at a time through a single Onshape session — multitask is decomposition and progress
                  tracking, not parallel writes.
                </p>
              </div>
            ) : null}

            <CadStepPane steps={state?.steps ?? []} />

            {busy === "chat" ? <p className="cad-agent-hint">Working in Onshape…</p> : null}
            {planRunning ? <p className="cad-agent-hint">Running approved plan steps in Onshape…</p> : null}
          </div>
          <div className="cad-agent-composer">
            <textarea
              rows={3}
              value={prompt}
              onChange={(event) => setPrompt(event.target.value)}
              placeholder="e.g. 80×50×6 mm plate, sketch on Top, extrude 6 mm."
              disabled={pendingProposal !== null || planRunning}
              onKeyDown={(event) => {
                if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
                  event.preventDefault();
                  void send();
                }
              }}
            />
            <div className="cad-agent-composer-bar">
              <span>{pendingProposal ? "Answer the mode question above first" : composerHint}</span>
              <button
                className="app-button"
                type="button"
                disabled={!prompt.trim() || anyBusy || pendingProposal !== null}
                onClick={() => void send()}
              >
                {busy === "chat" ? "Sending…" : "Send"}
              </button>
            </div>
          </div>
        </aside>

        <section className="cad-agent-viewport">
          <div className="cad-agent-col-head">
            <div className="cad-side-tabs" role="tablist" aria-label="Right pane">
              <button
                type="button"
                role="tab"
                className={`cad-side-tab${sidePanel === "viewport" ? " active" : ""}`}
                aria-selected={sidePanel === "viewport"}
                onClick={() => setSidePanel("viewport")}
              >
                Viewport
              </button>
              <button
                type="button"
                role="tab"
                className={`cad-side-tab${sidePanel === "files" ? " active" : ""}`}
                aria-selected={sidePanel === "files"}
                onClick={() => setSidePanel("files")}
              >
                Files
              </button>
            </div>
            <span className="cad-side-actions">
              {sidePanel === "viewport" ? (
                <button
                  type="button"
                  className="cad-view-refresh"
                  disabled={!state?.viewUrl || view.kind === "loading"}
                  onClick={() => void refreshView()}
                  title={view.kind === "ready" ? `Rendered ${view.at}` : undefined}
                >
                  {view.kind === "loading" ? "Rendering…" : "Refresh"}
                </button>
              ) : null}
              {state?.openUrl ? (
                <a href={state.openUrl} target="_blank" rel="noreferrer">
                  Open in Onshape
                </a>
              ) : (
                <span>Onshape</span>
              )}
            </span>
          </div>
          {sidePanel === "files" ? (
            <CadVaultPanel orgId={orgId} refreshKey={vaultRefresh} active={sidePanel === "files"} />
          ) : view.kind === "ready" || (view.kind === "loading" && view.src) || (view.kind === "error" && view.src) ? (
            <figure className={`cad-agent-view${view.kind === "loading" ? " is-loading" : ""}`}>
              <img
                src={view.kind === "ready" ? view.src : (view.src as string)}
                alt={`Isometric shaded view of ${state?.bound?.documentName ?? "the bound Part Studio"}`}
              />
              <figcaption>
                {view.kind === "ready"
                  ? `Shaded view rendered by Onshape at ${view.at}. Refreshes after every tool call.`
                  : view.kind === "error"
                    ? `Last render kept — refresh failed: ${view.message}`
                    : "Re-rendering…"}
              </figcaption>
            </figure>
          ) : view.kind === "setup_required" ? (
            <div className="cad-agent-empty-view">
              <p>{view.message}</p>
              <a className="app-button" href={connectionsHref}>
                Connect Onshape
              </a>
            </div>
          ) : view.kind === "error" ? (
            <div className="cad-agent-empty-view">
              <p>Onshape could not render this Part Studio: {view.message}</p>
              <button type="button" className="app-button secondary" onClick={() => void refreshView()}>
                Try again
              </button>
            </div>
          ) : view.kind === "loading" ? (
            <div className="cad-agent-empty-view">Rendering the Part Studio…</div>
          ) : boundOk && !state?.onshapeConnected ? (
            <div className="cad-agent-empty-view">
              <p>Part Studio bound, but no Onshape connection to render it with. Connect Onshape or use Open in Onshape.</p>
              <a className="app-button" href={connectionsHref}>
                Connect Onshape
              </a>
            </div>
          ) : (
            <div className="cad-agent-empty-view">
              No Part Studio bound. Paste an Onshape document URL above and click Bind — the viewport then shows a
              live shaded view rendered by Onshape (Onshape does not allow embedding its editor).
            </div>
          )}
        </section>
      </div>

      <CadToolsPanel tools={tools} />

      {adaptive ? <CadAdaptivePanel value={adaptive} busy={anyBusy} onSave={saveAdaptive} /> : null}

      <CadActivityPanel orgId={orgId} />
    </main>
  );
}
