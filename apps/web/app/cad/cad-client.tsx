"use client";

import { useEffect, useMemo, useState } from "react";

type Job = {
  id: string;
  title: string;
  platform: string;
  executionMode: string;
  status: string;
  brief: Record<string, unknown>;
  briefConfirmedAt: string | null;
  updatedAt: string;
};
type Step = {
  id: string;
  sequence: number;
  operation: string;
  parameters: Record<string, unknown>;
  status: string;
  approvalStatus: string;
  progress: number;
  error?: string | null;
};
type Device = {
  id: string;
  machineName: string;
  platform: string;
  status: string;
  lastSeenAt: string | null;
  revokedAt: string | null;
};
type UsageRow = {
  id: string;
  feature: string;
  model: string;
  keySource: string;
  costUsd: string;
  metadata: Record<string, unknown>;
  createdAt: string;
};

type Platform = "mock" | "onshape" | "fusion360";
type BrainMode = "mock" | "managed_api" | "terminal_cli";

const STEP_LESSONS: Record<string, { why: string; watch: string }> = {
  create_sketch: {
    why: "Sketches define the 2D envelope before any solid exists. FRC parts usually start from mounting holes and frame clearance.",
    watch: "Confirm units (mm vs in) and that the sketch plane matches how the part mounts on the robot.",
  },
  create_extrude: {
    why: "Extrude turns a closed profile into thickness. Depth is a design choice that affects weight and stiffness.",
    watch: "Check interference with belts, tubes, and game pieces before approving a deep extrude.",
  },
  extrude: {
    why: "Extrude turns a closed profile into thickness. Depth is a design choice that affects weight and stiffness.",
    watch: "Check interference with belts, tubes, and game pieces before approving a deep extrude.",
  },
  create_fillet: {
    why: "Fillets reduce stress risers and sharp edges that catch fabric or tape.",
    watch: "Large fillets eat material and can violate packaging — verify after topology check.",
  },
  fillet: {
    why: "Fillets reduce stress risers and sharp edges that catch fabric or tape.",
    watch: "Large fillets eat material and can violate packaging — verify after topology check.",
  },
  create_chamfer: {
    why: "Chamfers bevel edges for mating faces and bolt clearance.",
    watch: "Confirm the chamfer does not remove critical locating faces.",
  },
  feature_script: {
    why: "FeatureScript is the reviewed path for custom geometry when sketch/extrude helpers are not enough.",
    watch: "Only approve FeatureScript you or a mentor have read — treat generated scripts as untrusted until reviewed.",
  },
  boolean: {
    why: "Booleans cut or join bodies so one Part Studio can represent assemblies of intent.",
    watch: "Subtractive cuts are hard to undo in CAD history — approve only after reading the reason field.",
  },
  verify_topology: {
    why: "Topology verification proves the model still has expected faces/edges after a mutation.",
    watch: "A failed verify means stop and inspect — do not keep stacking mutations.",
  },
  render_views: {
    why: "Named views (iso/top/front) are the human checkpoint when you cannot open the CAD app.",
    watch: "Mock/demo renders are labeled. Live Onshape renders come from your bound document.",
  },
  create_checkpoint: {
    why: "Checkpoints freeze a fingerprint so later human edits in Onshape/Fusion can be detected.",
    watch: "If human-edit is flagged, re-review before running more automated steps.",
  },
  export_step: {
    why: "STEP is the interchange format for machining and other CAD tools.",
    watch: "Exports are not safety certification — still run team design review.",
  },
  export_stl: {
    why: "STL is for rapid prototypes and 3D print checks.",
    watch: "STL loses parametric intent; keep the source Part Studio as source of truth.",
  },
  export_gltf: {
    why: "glTF is for lightweight web preview of approved geometry.",
    watch: "Web preview fidelity is lower than native CAD — use it for review, not final fit.",
  },
};

function lessonFor(operation: string) {
  return (
    STEP_LESSONS[operation] ?? {
      why: "Each allowlisted operation mutates or verifies geometry under human approval.",
      watch: "Read the reason on the step, then approve only if it matches the brief.",
    }
  );
}

function platformLabel(platform: string) {
  if (platform === "onshape") return "Onshape hosted";
  if (platform === "fusion360") return "Fusion local relay";
  return "Mock / demo";
}

function statusBadge(status: string) {
  if (status === "completed" || status === "connected" || status === "running") return "good";
  if (status === "cancelled" || status === "failed" || status === "rejected") return "danger";
  if (status === "draft" || status === "awaiting_action_approval" || status === "planned") return "setup";
  return "";
}

function isOnline(device: Device | undefined) {
  if (!device?.lastSeenAt || device.revokedAt) return false;
  return Date.now() - new Date(device.lastSeenAt).getTime() < 90_000;
}

export default function CadWorkspace({ orgId }: { orgId: string }) {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [selected, setSelected] = useState("");
  const [detail, setDetail] = useState<{
    steps: Step[];
    artifacts: Array<{ id: string; type: string; title: string; content: Record<string, unknown> }>;
    checkpoints: Array<{ id: string; topology: Record<string, unknown>; humanEditDetected: boolean }>;
  } | null>(null);
  const [devices, setDevices] = useState<Device[]>([]);
  const [usage, setUsage] = useState<UsageRow[]>([]);
  const [title, setTitle] = useState("Strategy-linked mechanism");
  const [request, setRequest] = useState("Create a serviceable mechanism concept for the selected scoring task.");
  const [teamKey, setTeamKey] = useState("");
  const [platform, setPlatform] = useState<Platform>("mock");
  const [brainMode, setBrainMode] = useState<BrainMode>("mock");
  const [autoRunVerify, setAutoRunVerify] = useState(false);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [onshapeConfigured, setOnshapeConfigured] = useState(false);
  const [onshapeConnected, setOnshapeConnected] = useState(false);
  const [documentId, setDocumentId] = useState("");
  const [workspaceId, setWorkspaceId] = useState("");
  const [elementId, setElementId] = useState("");
  const [showExplain, setShowExplain] = useState(true);
  const [explainStepId, setExplainStepId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [onshapeDocs, setOnshapeDocs] = useState<Array<{ id: string; name: string; defaultWorkspaceId: string }>>([]);
  const [featureExplain, setFeatureExplain] = useState<{
    overview: string;
    steps: Array<{ order: number; name: string; featureType: string; plainEnglish: string; tip?: string }>;
    disclaimer: string;
  } | null>(null);

  async function load(jobId = selected) {
    const response = await fetch(`/api/cad?orgId=${encodeURIComponent(orgId)}${jobId ? `&jobId=${encodeURIComponent(jobId)}` : ""}`);
    const data = await response.json();
    if (response.ok) {
      setJobs(data.jobs ?? []);
      setDetail(data.detail);
      setDevices(data.devices ?? []);
      setUsage(data.usage ?? []);
      setOnshapeConfigured(Boolean(data.onshapeConfigured));
      setOnshapeConnected((data.onshapeConnections ?? []).some((c: { status: string }) => c.status === "connected"));
    } else setMessage(data.error);
  }

  useEffect(() => {
    void load();
    const timer = setInterval(() => void load(), 5000);
    return () => clearInterval(timer);
  }, [orgId, selected]);

  async function act(action: string, extra: Record<string, unknown> = {}) {
    setBusy(true);
    try {
      const response = await fetch("/api/cad", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ orgId, action, brainMode, autoRunVerify, ...extra }),
      });
      const data = await response.json();
      setMessage(
        response.ok
          ? action === "brief"
            ? "Engineering brief created. Confirm assumptions before geometry."
            : action === "cancel"
              ? "Job cancelled. Pending steps will not run."
              : action === "retry"
                ? "Step reset for retry — re-approve if required, then run again."
                : "CAD workspace updated."
          : data.error,
      );
      if (response.ok) {
        if (data.jobId) setSelected(data.jobId);
        await load(data.jobId ?? selected);
      }
      return data;
    } finally {
      setBusy(false);
    }
  }

  const job = jobs.find((item) => item.id === selected);
  const render = detail?.artifacts.find((item) => item.type === "render_checkpoint");
  const onlineDevice = devices.find((device) => !device.revokedAt && isOnline(device));
  const fusionReady = Boolean(onlineDevice);
  const onshapeReady = onshapeConfigured && onshapeConnected;
  const needsSetup = !jobs.length && !onshapeReady && !fusionReady;
  const activeExplainStep =
    detail?.steps.find((s) => s.id === explainStepId) ?? detail?.steps.find((s) => s.approvalStatus === "pending") ?? detail?.steps[0];
  const explainLesson = activeExplainStep ? lessonFor(activeExplainStep.operation) : null;

  const connectionTiles = useMemo(
    () => [
      {
        id: "mock",
        title: "Mock / demo",
        badge: "good" as const,
        badgeText: "Always available",
        body: "Deterministic topology + labeled demo renders. Best first path for teaching the approval loop.",
        ready: true,
      },
      {
        id: "onshape",
        title: "Onshape hosted",
        badge: (onshapeReady ? "good" : "setup") as "good" | "setup",
        badgeText: !onshapeConfigured
          ? "Admin OAuth setup"
          : onshapeConnected
            ? "Connected"
            : "Connect OAuth",
        body: "Cloud CAD via browser OAuth. Server runs approved jobs against your document — no desktop relay.",
        ready: onshapeReady,
        href: `/cad/connections?orgId=${orgId}`,
      },
      {
        id: "fusion",
        title: "Fusion 360 local",
        badge: (fusionReady ? "good" : "setup") as "good" | "setup",
        badgeText: fusionReady ? "Relay online" : "Desktop relay required",
        body: "Jobs stay on your machine. Vantage never hosts or runs Fusion on Vercel — pair vantage-cad + the Fusion add-in.",
        ready: fusionReady,
        href: `/cad/setup?orgId=${orgId}`,
      },
    ],
    [fusionReady, onshapeConfigured, onshapeConnected, onshapeReady, orgId],
  );

  const isVerify = (operation: string) =>
    ["verify_topology", "render_views", "create_checkpoint", "export_step", "export_stl", "export_gltf"].includes(
      operation,
    );

  const canCancel = job && !["cancelled", "completed"].includes(job.status);
  const failedSteps = detail?.steps.filter((s) => s.status === "failed" || s.status === "cancelled") ?? [];

  return (
    <main className="module-page cad-module">
      <header className="app-page-header">
        <div>
          <p className="breadcrumbs">Workspace / CAD Builder</p>
          <h1>CAD Builder</h1>
          <p>
            Strategy → cited brief → allowlisted plan → human approval → geometry checkpoints. Not certified engineering
            software. Fusion stays local — never hosted on Vercel.
          </p>
        </div>
        <div className="cad-header-actions">
          <a className="app-button secondary" href={`/cad/setup?orgId=${orgId}`}>
            Setup wizard
          </a>
          <a className="app-button secondary" href={`/cad/connections?orgId=${orgId}`}>
            Connections
          </a>
          <a className="app-button secondary" href={`/cad/pair?orgId=${orgId}`}>
            Pair desktop
          </a>
          <button
            type="button"
            className="app-button secondary"
            aria-pressed={showExplain}
            onClick={() => setShowExplain((v) => !v)}
          >
            {showExplain ? "Hide student panel" : "Show student panel"}
          </button>
        </div>
      </header>

      <nav className="intel-actions" aria-label="AI governance" style={{ marginBottom: 12 }}>
        <a href={`/chat?orgId=${encodeURIComponent(orgId)}`}>Assistant</a>
        <a href={`/code?orgId=${encodeURIComponent(orgId)}`}>Code Coach</a>
        <a href={`/team/budgets?orgId=${encodeURIComponent(orgId)}#prompt-caching`}>Prompt caching</a>
        <a href={`/team/usage?orgId=${encodeURIComponent(orgId)}`}>AI usage</a>
        <a href={`/team/ai-runs?orgId=${encodeURIComponent(orgId)}`}>AI runs</a>
      </nav>

      {message ? (
        <p className="telemetry-status" role="status">
          {message}
        </p>
      ) : null}

      <section className="cad-connection-strip" aria-label="CAD connection status">
        {connectionTiles.map((tile) => (
          <article key={tile.id} className={`app-card cad-connection-tile${tile.ready ? " ready" : " needs-setup"}`}>
            <div>
              <span className={`app-badge ${tile.badge}`}>{tile.badgeText}</span>
              <h2>{tile.title}</h2>
              <p className="app-muted">{tile.body}</p>
            </div>
            {"href" in tile && tile.href && !tile.ready ? (
              <a className="primary-action" href={tile.href}>
                Connect / setup
              </a>
            ) : (
              <span className={`cad-ready-dot ${tile.ready ? "on" : "off"}`}>
                {tile.ready ? "Ready" : "Not ready"}
              </span>
            )}
          </article>
        ))}
      </section>

      {needsSetup ? (
        <section className="app-empty cad-empty-setup">
          <span className="app-badge setup">First-run</span>
          <h2>Start with mock, then connect a real CAD path</h2>
          <p>
            Create a mock job to learn the brief → plan → approve loop. When you are ready for live geometry, connect
            Onshape OAuth (hosted) or pair a Fusion desktop relay (local only — never claimed as cloud-hosted).
          </p>
          <div className="cad-empty-actions">
            <button type="button" className="primary-action" onClick={() => setCreating(true)}>
              New mock brief
            </button>
            <a className="app-button secondary" href={`/cad/setup?orgId=${orgId}`}>
              Open setup wizard
            </a>
          </div>
        </section>
      ) : null}

      <div className={`cad-workbench ${showExplain ? "with-explain" : ""}`}>
        <aside className="app-card cad-queue" aria-label="CAD job queue">
          <div className="cad-queue-head">
            <div>
              <span className="eyebrow">JOB QUEUE</span>
              <h2>History</h2>
            </div>
            <button type="button" className="app-button secondary" onClick={() => { setSelected(""); setCreating(true); }}>
              New
            </button>
          </div>
          {!jobs.length ? (
            <p className="app-muted">No jobs yet. Create a brief to start an engineering thread.</p>
          ) : (
            <ul className="cad-job-list">
              {jobs.map((item) => (
                <li key={item.id}>
                  <button
                    type="button"
                    className={selected === item.id ? "active" : ""}
                    onClick={() => {
                      setSelected(item.id);
                      setCreating(false);
                    }}
                  >
                    <strong>{item.title}</strong>
                    <small>
                      {platformLabel(item.platform)} · {item.status.replaceAll("_", " ")}
                    </small>
                    <span className={`app-badge ${statusBadge(item.status)}`}>{item.status}</span>
                  </button>
                  {selected === item.id ? (
                    <div className="cad-job-actions">
                      {canCancel ? (
                        <button type="button" disabled={busy} onClick={() => void act("cancel", { jobId: item.id })}>
                          Cancel
                        </button>
                      ) : null}
                      {failedSteps.length ? (
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => void act("retry", { jobId: item.id, stepId: failedSteps[0]!.id })}
                        >
                          Retry failed
                        </button>
                      ) : null}
                    </div>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
          {usage.length ? (
            <div className="cad-usage-ledger">
              <span className="eyebrow">USAGE LEDGER</span>
              {usage.slice(0, 5).map((row) => (
                <article key={row.id}>
                  <strong>{String(row.metadata.ledgerTag ?? row.keySource)}</strong>
                  <small>
                    {row.model} · ${Number(row.costUsd).toFixed(4)} · {new Date(row.createdAt).toLocaleString()}
                  </small>
                </article>
              ))}
            </div>
          ) : null}
        </aside>

        <section className="app-card cad-main-pane">
          {(creating || !job) && !selected ? (
            <>
              <span className="eyebrow">STRATEGY → ENGINEERING BRIEF</span>
              <h2>Start with intent, not geometry</h2>
              <p className="app-muted">
                Pick a CAD path first. Mock teaches the workflow. Onshape is hosted cloud CAD. Fusion is local-only via
                your Autodesk desktop session.
              </p>
              <form
                className="cad-brief-form"
                onSubmit={(event) => {
                  event.preventDefault();
                  void act("brief", {
                    title,
                    request,
                    teamKey,
                    platform,
                    executionMode: platform === "fusion360" ? "local" : "hosted",
                  }).then(() => setCreating(false));
                }}
              >
                <fieldset className="cad-mode-picker">
                  <legend>CAD path</legend>
                  <label className={platform === "mock" ? "active" : ""}>
                    <input type="radio" name="platform" checked={platform === "mock"} onChange={() => setPlatform("mock")} />
                    <span>
                      <strong>Mock / demo</strong>
                      <small>Safe teaching path · labeled demo renders</small>
                    </span>
                  </label>
                  <label className={platform === "onshape" ? "active" : ""}>
                    <input
                      type="radio"
                      name="platform"
                      checked={platform === "onshape"}
                      disabled={!onshapeReady}
                      onChange={() => setPlatform("onshape")}
                    />
                    <span>
                      <strong>Onshape hosted</strong>
                      <small>
                        {!onshapeConfigured
                          ? "Admin must set ONSHAPE_OAUTH_* then redeploy"
                          : !onshapeConnected
                            ? "Connect OAuth in Connections first"
                            : "OAuth connected · bind document after brief"}
                      </small>
                    </span>
                  </label>
                  <label className={platform === "fusion360" ? "active" : ""}>
                    <input
                      type="radio"
                      name="platform"
                      checked={platform === "fusion360"}
                      onChange={() => setPlatform("fusion360")}
                    />
                    <span>
                      <strong>Fusion 360 local relay</strong>
                      <small>
                        {fusionReady
                          ? `${onlineDevice?.machineName} online — jobs claim on this machine`
                          : "Not hosted on Vercel — pair desktop relay to execute"}
                      </small>
                    </span>
                  </label>
                </fieldset>
                <label>
                  Concept title
                  <input value={title} onChange={(e) => setTitle(e.target.value)} required />
                </label>
                <label>
                  Selected team (optional)
                  <input value={teamKey} onChange={(e) => setTeamKey(e.target.value)} placeholder="frc254" />
                </label>
                <label>
                  AI brain
                  <select value={brainMode} onChange={(e) => setBrainMode(e.target.value as BrainMode)}>
                    <option value="mock">Mock (CI / demo)</option>
                    <option value="managed_api">Vantage managed API (meters credits)</option>
                    <option value="terminal_cli">Terminal CLI subscription path (no Vantage model charge)</option>
                  </select>
                  <small>
                    ChatGPT Plus / Claude Pro are not API keys. Terminal path uses your official CLI login via
                    vantage-cad.
                  </small>
                </label>
                <label className="check-field">
                  <input type="checkbox" checked={autoRunVerify} onChange={(e) => setAutoRunVerify(e.target.checked)} />
                  Auto-run verification steps within allowlist (still never claims certified engineering)
                </label>
                <label>
                  What should this mechanism accomplish?
                  <textarea rows={6} value={request} onChange={(e) => setRequest(e.target.value)} />
                </label>
                <button className="primary-action" disabled={busy}>
                  Build cited engineering brief
                </button>
              </form>
            </>
          ) : job ? (
            <>
              <div className="cad-job-banner">
                <div>
                  <span className={`app-badge ${statusBadge(job.status)}`}>{job.status.replaceAll("_", " ")}</span>
                  <span className="app-badge">{platformLabel(job.platform)}</span>
                  {job.platform === "fusion360" ? (
                    <span className="app-badge setup">Local only · not Vercel-hosted</span>
                  ) : null}
                  {job.platform === "mock" ? <span className="app-badge demo">Demo / mock</span> : null}
                  <h2>{job.title}</h2>
                </div>
                {canCancel ? (
                  <button type="button" className="app-button secondary" disabled={busy} onClick={() => void act("cancel", { jobId: job.id })}>
                    Cancel job
                  </button>
                ) : null}
              </div>
              <BriefEditor
                job={job}
                onConfirm={(brief) => act("confirm", { jobId: job.id, brief })}
                onPlan={() => act("plan-default", { jobId: job.id, includeExport: job.platform === "onshape" ? "step" : false })}
              />
              {job.platform === "onshape" ? (
                <form
                  className="cad-document-ref"
                  onSubmit={(event) => {
                    event.preventDefault();
                    void act("set-document", {
                      jobId: job.id,
                      documentRef: { documentId, workspaceId, elementId, label: documentId },
                    });
                  }}
                >
                  <span className="eyebrow">ONSHAPE DOCUMENT</span>
                  <p className="app-muted">Bind a disposable document for first live tests. Exports write STEP provenance into team CAD artifacts.</p>
                  <div className="intel-actions" style={{ marginBottom: "0.75rem", gap: "0.5rem", flexWrap: "wrap" }}>
                    <button
                      type="button"
                      className="app-button secondary"
                      disabled={busy || !onshapeConnected}
                      onClick={() =>
                        void act("list-onshape-documents", {}).then((data) => {
                          const docs = (data as { documents?: Array<{ id: string; name: string; defaultWorkspaceId: string }> })
                            .documents;
                          if (docs) setOnshapeDocs(docs);
                        })
                      }
                    >
                      List my documents
                    </button>
                    <button
                      type="button"
                      className="app-button secondary"
                      disabled={busy || !documentId || !workspaceId || !elementId}
                      onClick={() =>
                        void act("explain-onshape-features", {
                          jobId: job.id,
                          documentRef: { documentId, workspaceId, elementId },
                        }).then((data) => {
                          const explain = (data as { explain?: typeof featureExplain }).explain;
                          if (explain) {
                            setFeatureExplain(explain);
                            setShowExplain(true);
                          }
                        })
                      }
                    >
                      Explain feature tree
                    </button>
                  </div>
                  {onshapeDocs.length > 0 ? (
                    <label>
                      Pick a document
                      <select
                        value={documentId}
                        onChange={(e) => {
                          const doc = onshapeDocs.find((d) => d.id === e.target.value);
                          setDocumentId(e.target.value);
                          if (doc?.defaultWorkspaceId) setWorkspaceId(doc.defaultWorkspaceId);
                        }}
                      >
                        <option value="">Select…</option>
                        {onshapeDocs.map((doc) => (
                          <option key={doc.id} value={doc.id}>
                            {doc.name}
                          </option>
                        ))}
                      </select>
                    </label>
                  ) : null}
                  <label>
                    Document ID
                    <input value={documentId} onChange={(e) => setDocumentId(e.target.value)} required />
                  </label>
                  <label>
                    Workspace ID
                    <input value={workspaceId} onChange={(e) => setWorkspaceId(e.target.value)} required />
                  </label>
                  <label>
                    Element ID (Part Studio)
                    <input value={elementId} onChange={(e) => setElementId(e.target.value)} required />
                  </label>
                  <button type="submit" className="primary-action" disabled={busy}>
                    Bind document refs
                  </button>
                </form>
              ) : null}
              <p className="cad-disclaimer">Design review flags are suggestions, not engineering or safety certification.</p>
            </>
          ) : (
            <div className="app-empty">
              <p>Select a job from the queue or create a new brief.</p>
            </div>
          )}
        </section>

        <section className="cad-right-column">
          <div className="app-card cad-visual-card">
            <div className="cad-render">
              <span>
                {job?.platform === "mock" || !render
                  ? "CHECKPOINT RENDER"
                  : job?.platform === "onshape"
                    ? "ONSHAPE CHECKPOINT"
                    : "FUSION RELAY CHECKPOINT"}
                {job?.platform === "mock" && render ? " · DEMO / MOCK" : ""}
              </span>
              {render ? (
                <iframe sandbox="" title="Isolated CAD checkpoint render" srcDoc={String(render.content.content ?? "")} />
              ) : (
                <div className="render-empty">
                  No geometry mutation yet.
                  <small>Confirm brief → preview plan → approve each step</small>
                </div>
              )}
            </div>
            <div className="cad-timeline">
              <span className="eyebrow">STEP TIMELINE</span>
              {!detail?.steps.length ? (
                <p className="app-muted">Plan appears here after you confirm the brief.</p>
              ) : (
                detail.steps.map((step) => (
                  <article key={step.id} className={explainStepId === step.id ? "focused" : ""}>
                    <i className={step.status} />
                    <button type="button" className="cad-step-select" onClick={() => { setExplainStepId(step.id); setShowExplain(true); }}>
                      <strong>
                        {step.sequence}. {step.operation.replaceAll("_", " ")}
                      </strong>
                      <small>
                        {step.status} · {step.progress}%
                        {step.approvalStatus === "rejected" ? " · Rejected" : ""}
                        {step.error ? ` · ${step.error}` : ""}
                      </small>
                    </button>
                    <div className="cad-step-actions">
                      {step.approvalStatus === "pending" && (
                        <>
                          <button type="button" disabled={busy} onClick={() => void act("approve", { jobId: job!.id, stepId: step.id, approved: true })}>
                            Approve
                          </button>
                          <button type="button" disabled={busy} onClick={() => void act("approve", { jobId: job!.id, stepId: step.id, approved: false })}>
                            Reject
                          </button>
                        </>
                      )}
                      {step.approvalStatus === "approved" &&
                        step.status === "planned" &&
                        job?.platform === "mock" &&
                        brainMode === "mock" && (
                          <button type="button" disabled={busy} onClick={() => void act("execute-mock", { jobId: job!.id, stepId: step.id })}>
                            {autoRunVerify && isVerify(step.operation) ? "Auto-run verify" : "Run mock"}
                          </button>
                        )}
                      {step.approvalStatus === "approved" &&
                        step.status === "planned" &&
                        job?.platform === "mock" &&
                        brainMode !== "mock" && (
                          <button type="button" disabled={busy} onClick={() => void act("execute-api-stub", { jobId: job!.id, stepId: step.id })}>
                            Run API stub ({brainMode === "terminal_cli" ? "local_cli $0" : "metered"})
                          </button>
                        )}
                      {step.approvalStatus === "approved" &&
                        step.status === "planned" &&
                        job?.platform === "onshape" && (
                          <button type="button" disabled={busy} onClick={() => void act("execute-onshape", { jobId: job!.id, stepId: step.id })}>
                            Run Onshape
                          </button>
                        )}
                      {step.approvalStatus === "approved" &&
                        step.status === "planned" &&
                        job?.platform === "fusion360" && (
                          <small className="app-muted">Waiting for vantage-cad relay claim on your desktop…</small>
                        )}
                      {(step.status === "failed" || step.status === "cancelled") && (
                        <button type="button" disabled={busy} onClick={() => void act("retry", { jobId: job!.id, stepId: step.id })}>
                          Retry
                        </button>
                      )}
                    </div>
                  </article>
                ))
              )}
              {detail?.checkpoints.map((checkpoint) => (
                <article key={checkpoint.id}>
                  <i className="completed" />
                  <div>
                    <strong>Topology verified</strong>
                    <small>
                      {checkpoint.humanEditDetected
                        ? "Human edit detected · review before resume"
                        : JSON.stringify(checkpoint.topology)}
                    </small>
                  </div>
                </article>
              ))}
            </div>
          </div>

          {showExplain ? (
            <aside className="app-card cad-explain-panel" aria-label="Student explain panel">
              <span className="eyebrow">STUDENT EXPLAIN</span>
              <h2>Why this step exists</h2>
              {activeExplainStep && explainLesson ? (
                <>
                  <p className="cad-explain-op">
                    <strong>{activeExplainStep.operation.replaceAll("_", " ")}</strong>
                    <span className={`app-badge ${statusBadge(activeExplainStep.status)}`}>
                      {activeExplainStep.status}
                    </span>
                  </p>
                  <h3>Why</h3>
                  <p>{explainLesson.why}</p>
                  <h3>What to watch</h3>
                  <p>{explainLesson.watch}</p>
                  {activeExplainStep.parameters?.reason ? (
                    <>
                      <h3>Plan reason</h3>
                      <p className="app-muted">{String(activeExplainStep.parameters.reason)}</p>
                    </>
                  ) : null}
                  <div className="cad-explain-tips">
                    <h3>Platform truth</h3>
                    <ul>
                      <li>
                        <strong>Onshape</strong> — hosted OAuth; Vantage server executes approved ops against your
                        document.
                      </li>
                      <li>
                        <strong>Fusion</strong> — local Autodesk session only. Never presented as cloud-hosted Fusion.
                      </li>
                      <li>
                        <strong>Mock</strong> — teaches the loop with deterministic checkpoints; renders are labeled demo.
                      </li>
                    </ul>
                  </div>
                </>
              ) : (
                <p className="app-muted">
                  Confirm a brief and preview a plan. Select any timeline step to learn why it is in the allowlist and
                  what a mentor should verify before approval.
                </p>
              )}
              {featureExplain ? (
                <div className="cad-explain-tips" style={{ marginTop: "1.25rem" }}>
                  <h3>Live feature tree</h3>
                  <p>{featureExplain.overview}</p>
                  <ol>
                    {featureExplain.steps.slice(0, 12).map((step) => (
                      <li key={`${step.order}-${step.name}`}>
                        <strong>{step.name}</strong> ({step.featureType}) — {step.plainEnglish}
                        {step.tip ? <small> Tip: {step.tip}</small> : null}
                      </li>
                    ))}
                  </ol>
                  <p className="app-muted">{featureExplain.disclaimer}</p>
                </div>
              ) : null}
              {detail?.artifacts.some((a) => a.type.startsWith("cad_export_")) ? (
                <div className="cad-explain-tips" style={{ marginTop: "1rem" }}>
                  <h3>Export provenance</h3>
                  <ul>
                    {detail.artifacts
                      .filter((a) => a.type.startsWith("cad_export_"))
                      .map((artifact) => (
                        <li key={artifact.id}>
                          <strong>{artifact.title}</strong>
                          <small className="app-muted">
                            {" "}
                            · checksum in artifact ·{" "}
                            {String((artifact.content?.provenance as { format?: string } | undefined)?.format ?? artifact.type)}
                          </small>
                        </li>
                      ))}
                  </ul>
                </div>
              ) : null}
            </aside>
          ) : null}
        </section>
      </div>
    </main>
  );
}

function BriefEditor({
  job,
  onConfirm,
  onPlan,
}: {
  job: Job;
  onConfirm: (brief: Record<string, unknown>) => unknown;
  onPlan: () => unknown;
}) {
  const [brief, setBrief] = useState(job.brief);
  useEffect(() => setBrief(job.brief), [job.id, job.brief]);
  const assumptions = (brief.assumptions ?? []) as Array<{ name: string; value: string; needsConfirmation: boolean }>;
  return (
    <section className="brief-editor">
      <label>
        Summary
        <textarea
          rows={4}
          value={String(brief.summary ?? "")}
          onChange={(e) => setBrief({ ...brief, summary: e.target.value })}
        />
      </label>
      <h3>Assumptions to confirm</h3>
      {assumptions.map((item, index) => (
        <label key={item.name}>
          {item.name}
          <input
            value={item.value}
            onChange={(e) =>
              setBrief({
                ...brief,
                assumptions: assumptions.map((entry, i) =>
                  i === index ? { ...entry, value: e.target.value, needsConfirmation: false } : entry,
                ),
              })
            }
          />
        </label>
      ))}
      <details open>
        <summary>Requirements, constraints, risk, and acceptance</summary>
        <pre>
          {JSON.stringify(
            {
              requirements: brief.requirements,
              constraints: brief.constraints,
              scoringTasks: brief.scoringTasks,
              risks: brief.risks,
              acceptanceCriteria: brief.acceptanceCriteria,
              sourceRefs: brief.sourceRefs,
            },
            null,
            2,
          )}
        </pre>
      </details>
      {!job.briefConfirmedAt ? (
        <button type="button" className="primary-action" onClick={() => onConfirm(brief)}>
          Confirm engineering brief
        </button>
      ) : (
        <button type="button" className="primary-action" onClick={onPlan}>
          Preview safe action plan
        </button>
      )}
    </section>
  );
}
