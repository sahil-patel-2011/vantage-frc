"use client";

import { useEffect, useState } from "react";
import { VantageLogo } from "../../components/brand";

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
};
type Device = {
  id: string;
  machineName: string;
  platform: string;
  status: string;
  lastSeenAt: string | null;
  revokedAt: string | null;
};

export default function CadWorkspace({ orgId }: { orgId: string }) {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [selected, setSelected] = useState("");
  const [detail, setDetail] = useState<{
    steps: Step[];
    artifacts: Array<{ id: string; type: string; title: string; content: Record<string, unknown> }>;
    checkpoints: Array<{ id: string; topology: Record<string, unknown>; humanEditDetected: boolean }>;
  } | null>(null);
  const [devices, setDevices] = useState<Device[]>([]);
  const [title, setTitle] = useState("Strategy-linked mechanism");
  const [request, setRequest] = useState("Create a serviceable mechanism concept for the selected scoring task.");
  const [teamKey, setTeamKey] = useState("");
  const [platform, setPlatform] = useState<"mock" | "onshape" | "fusion360">("mock");
  const [brainMode, setBrainMode] = useState<"mock" | "managed_api" | "terminal_cli">("mock");
  const [autoRunVerify, setAutoRunVerify] = useState(false);
  const [message, setMessage] = useState("");

  async function load(jobId = selected) {
    const response = await fetch(`/api/cad?orgId=${orgId}${jobId ? `&jobId=${jobId}` : ""}`);
    const data = await response.json();
    if (response.ok) {
      setJobs(data.jobs ?? []);
      setDetail(data.detail);
      setDevices(data.devices ?? []);
    } else setMessage(data.error);
  }

  useEffect(() => {
    void load();
    const timer = setInterval(() => void load(), 5000);
    return () => clearInterval(timer);
  }, [orgId, selected]);

  async function act(action: string, extra: Record<string, unknown> = {}) {
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
          : "CAD workspace updated."
        : data.error,
    );
    if (response.ok) {
      if (data.jobId) setSelected(data.jobId);
      await load(data.jobId ?? selected);
    }
    return data;
  }

  const job = jobs.find((item) => item.id === selected);
  const render = detail?.artifacts.find((item) => item.type === "render_checkpoint");
  const onlineDevice = devices.find((device) => !device.revokedAt && device.lastSeenAt);
  const isVerify = (operation: string) =>
    ["verify_topology", "render_views", "create_checkpoint", "export_step", "export_stl", "export_gltf"].includes(
      operation,
    );

  return (
    <main className="cad-workspace">
      <header className="workspace-top">
        <VantageLogo href="/dashboard" />
        <strong>CAD BUILDER</strong>
        <a href={`/cad/setup?orgId=${orgId}`}>Setup wizard</a>
        <a href={`/workspace?orgId=${orgId}`}>Workspace</a>
        <a href={`/cad/connections?orgId=${orgId}`}>Connections</a>
      </header>
      {message ? (
        <p className="telemetry-status" role="status">
          {message}
        </p>
      ) : null}
      <div className="cad-shell">
        <aside className="cad-jobs">
          <span className="eyebrow">ENGINEERING THREADS</span>
          <p className="cad-relay-status">
            Relay:{" "}
            {onlineDevice
              ? `${onlineDevice.machineName} online (${onlineDevice.platform})`
              : "No paired desktop heartbeat"}
          </p>
          {jobs.map((item) => (
            <button className={selected === item.id ? "active" : ""} onClick={() => setSelected(item.id)} key={item.id}>
              <strong>{item.title}</strong>
              <small>
                {item.platform} · {item.status}
              </small>
            </button>
          ))}
        </aside>
        <section className="cad-conversation">
          <span className="eyebrow">STRATEGY → ENGINEERING BRIEF</span>
          <h1>{job?.title ?? "Start with intent, not geometry"}</h1>
          {!job ? (
            <form
              onSubmit={(event) => {
                event.preventDefault();
                void act("brief", {
                  title,
                  request,
                  teamKey,
                  platform,
                  executionMode: platform === "fusion360" ? "local" : "hosted",
                });
              }}
            >
              <label>
                Concept title
                <input value={title} onChange={(event) => setTitle(event.target.value)} required />
              </label>
              <label>
                Selected team (optional)
                <input value={teamKey} onChange={(event) => setTeamKey(event.target.value)} placeholder="frc254" />
              </label>
              <label>
                CAD path
                <select value={platform} onChange={(event) => setPlatform(event.target.value as typeof platform)}>
                  <option value="mock">Deterministic mock</option>
                  <option value="onshape" disabled>
                    Onshape hosted OAuth (admin setup required)
                  </option>
                  <option value="fusion360">Fusion 360 local relay</option>
                </select>
              </label>
              <label>
                AI brain
                <select value={brainMode} onChange={(event) => setBrainMode(event.target.value as typeof brainMode)}>
                  <option value="mock">Mock (CI / demo)</option>
                  <option value="managed_api">Vantage managed API (meters credits)</option>
                  <option value="terminal_cli">Terminal CLI subscription path (no Vantage model charge)</option>
                </select>
                <small>
                  ChatGPT Plus / Claude Pro are not API keys. Terminal path uses your official CLI login via vantage-cad.
                </small>
              </label>
              <label className="check-field">
                <input type="checkbox" checked={autoRunVerify} onChange={(event) => setAutoRunVerify(event.target.checked)} />
                Auto-run verification steps within allowlist (still never claims certified engineering)
              </label>
              <label>
                What should this mechanism accomplish?
                <textarea rows={7} value={request} onChange={(event) => setRequest(event.target.value)} />
              </label>
              <button className="primary-action">Build cited engineering brief</button>
            </form>
          ) : (
            <BriefEditor
              job={job}
              onConfirm={(brief) => act("confirm", { jobId: job.id, brief })}
              onPlan={() => act("plan-default", { jobId: job.id })}
            />
          )}
          <p className="cad-disclaimer">Design review flags are suggestions, not engineering or safety certification.</p>
        </section>
        <section className="cad-visual">
          <div className="cad-render">
            <span>LIVE VERIFIED CHECKPOINT</span>
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
            <span className="eyebrow">JOB TIMELINE</span>
            {detail?.steps.map((step) => (
              <article key={step.id}>
                <i className={step.status} />
                <div>
                  <strong>
                    {step.sequence}. {step.operation.replaceAll("_", " ")}
                  </strong>
                  <small>
                    {step.status} · {step.progress}%
                    {step.approvalStatus === "rejected" ? " · Rejected" : ""}
                  </small>
                </div>
                {step.approvalStatus === "pending" && (
                  <>
                    <button onClick={() => void act("approve", { jobId: job!.id, stepId: step.id, approved: true })}>
                      Approve
                    </button>
                    <button onClick={() => void act("approve", { jobId: job!.id, stepId: step.id, approved: false })}>
                      Reject
                    </button>
                  </>
                )}
                {step.approvalStatus === "approved" &&
                  step.status === "planned" &&
                  job?.platform === "mock" &&
                  brainMode === "mock" && (
                    <button onClick={() => void act("execute-mock", { jobId: job!.id, stepId: step.id })}>
                      {autoRunVerify && isVerify(step.operation) ? "Auto-run verify" : "Run mock"}
                    </button>
                  )}
                {step.approvalStatus === "approved" &&
                  step.status === "planned" &&
                  job?.platform === "mock" &&
                  brainMode !== "mock" && (
                    <button onClick={() => void act("execute-api-stub", { jobId: job!.id, stepId: step.id })}>
                      Run API stub ({brainMode === "terminal_cli" ? "local_cli $0" : "metered"})
                    </button>
                  )}
                {step.approvalStatus === "approved" &&
                  step.status === "planned" &&
                  (job?.platform === "fusion360" || job?.platform === "onshape") && (
                    <small>
                      {job.platform === "fusion360"
                        ? "Waiting for vantage-cad relay claim…"
                        : "Onshape hosted execute requires OAuth setup"}
                    </small>
                  )}
              </article>
            ))}
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
        <textarea rows={4} value={String(brief.summary ?? "")} onChange={(e) => setBrief({ ...brief, summary: e.target.value })} />
      </label>
      <h2>Assumptions to confirm</h2>
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
        <button className="primary-action" onClick={() => onConfirm(brief)}>
          Confirm engineering brief
        </button>
      ) : (
        <button className="primary-action" onClick={onPlan}>
          Preview safe action plan
        </button>
      )}
    </section>
  );
}
