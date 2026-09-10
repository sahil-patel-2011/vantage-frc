"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { assemblyPdfOfflineKey, keepOfflineFile } from "../../lib/offline/file-bytes";

/**
 * The assembly manual surface.
 *
 * Three states, and the page never blurs the line between them: nothing set up
 * (no Onshape, no relay), a run in flight (progress, and the ability to stop
 * it), and a finished book (steps to read on screen, a PDF to print, and a
 * report saying how it was checked).
 *
 * The design rule that matters here is the same one the engine follows: a step
 * with no render shows a labelled placeholder saying which Onshape call failed,
 * never a stand-in picture; a fabrication line the CAD does not support prints
 * its own caveat and is styled as unconfirmed rather than dropped.
 */

type RunStatus = "queued" | "running" | "paused" | "completed" | "failed" | "cancelled";

type Run = {
  id: string;
  startedByName: string | null;
  onshapeUrl: string;
  assemblyName: string;
  status: RunStatus;
  progress: { stage?: string; stepsDone?: number; stepsTotal?: number; rendersDone?: number; note?: string };
  report: Report | null;
  error: string | null;
  pdfByteSize: number | null;
  cancelRequestedAt: string | null;
  createdAt: string;
  completedAt: string | null;
  updatedAt: string;
};

type Report = {
  strategyUsed?: string;
  checksRun?: number;
  checksPassed?: number;
  disagreements?: Array<{ instanceId: string; name: string; matePosition: number; geometryPosition: number; note: string }>;
  unresolved?: Array<{ instanceId: string; name: string; reason: string }>;
  notes?: string[];
  gaps?: string[];
  renderModes?: Record<string, number>;
  sentenceSources?: Record<string, number>;
  cotsCatalog?: string;
  onshapeCalls?: number;
  cutList?: Array<{
    partName: string;
    material: string | null;
    quantity: number;
    lengthMm: number | null;
    profile: string | null;
    lengthConfirmed: boolean;
  }>;
  hardware?: Array<{ partName: string; quantity: number }>;
};

type StepPart = { name: string; quantity: number; extentMm: number[] | null; cots: { vendor: string; sku: string } | null };
type FabLine = { kind: string; text: string; confirmed: boolean };
type Step = {
  stepNumber: number;
  subassembly: string;
  title: string;
  sentence: string;
  sentenceSource: "model" | "deterministic";
  parts: StepPart[];
  fabrication: FabLine[];
  feasibility: { prerequisites?: string[]; checks?: Array<{ id: string; passed: boolean; detail: string }>; notes?: string[] };
  disagreement: { otherPosition: number; strategy: string; note: string } | null;
  renderMode: string;
  renderNote: string;
  hasRender: boolean;
};

type Overview = {
  orgName: string;
  canStart: boolean;
  onshape: { connected: boolean; configured: boolean; message: string };
  worker: { lastCheckIn: string | null; message: string };
  vault: Array<{ id: string; title: string; externalUrl: string; seasonYear: number }>;
  runs: Run[];
};

type StartResult =
  | { status: "queued"; runId: string; assemblyName: string }
  | { status: "not_connected"; message: string }
  | { status: "no_assembly"; message: string }
  | {
      status: "choose_assembly";
      message: string;
      documentId: string;
      workspaceId: string;
      assemblies: Array<{ id: string; name: string; elementType: string }>;
    };

const ACTIVE: RunStatus[] = ["queued", "running", "paused"];

function inches(mm: number): string {
  return `${(mm / 25.4).toFixed(2)} in`;
}

function when(value: string | null): string {
  if (!value) return "never";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}

export default function AssemblyManualClient() {
  const [overview, setOverview] = useState<Overview | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [openRunId, setOpenRunId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/assembly-manual", { cache: "no-store" });
      const body = (await response.json()) as Overview & { error?: string };
      if (!response.ok) throw new Error(body.error ?? "Could not load assembly manual runs.");
      setOverview(body);
      setLoadError(null);
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : "Could not load assembly manual runs.");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const orgId = new URLSearchParams(window.location.search).get("orgId");
    if (!orgId || !overview) return;
    for (const run of overview.runs) {
      if (run.status !== "completed" || !run.pdfByteSize) continue;
      void keepOfflineFile({
        key: assemblyPdfOfflineKey(orgId, run.id),
        orgId,
        name: `${run.assemblyName || "assembly-manual"}.pdf`,
        url: `/api/assembly-manual/${run.id}/pdf`,
        contentType: "application/pdf",
        expectedBytes: run.pdfByteSize,
      });
    }
  }, [overview]);

  const hasActive = useMemo(
    () => (overview?.runs ?? []).some((run) => ACTIVE.includes(run.status)),
    [overview],
  );

  // Poll only while something is actually moving. A finished list does not need
  // a request every five seconds for as long as the tab is open.
  useEffect(() => {
    if (!hasActive) return;
    const timer = setInterval(() => void load(), 5000);
    return () => clearInterval(timer);
  }, [hasActive, load]);

  return (
    <main className="module-page am-page">
      <header className="am-hero">
        <p className="am-kicker">Build · CAD</p>
        <h1>Assembly manual</h1>
        <p className="am-lead">
          Point this at your Onshape assembly and it produces a build book: numbered steps, a render of each
          one, the parts that go on, and the cutting, drilling and tapping the CAD actually specifies. Every
          measurement comes out of the model. Anything the model does not say is printed as{" "}
          <em>&ldquo;confirm &mdash; not specified in CAD&rdquo;</em> rather than guessed.
        </p>
      </header>

      {loadError ? <p className="am-error">{loadError}</p> : null}

      {overview ? (
        <>
          <Setup overview={overview} />
          <StartPanel overview={overview} onStarted={(runId) => {
            setOpenRunId(runId);
            void load();
          }} />
          <RunList runs={overview.runs} openRunId={openRunId} onOpen={setOpenRunId} />
          {openRunId ? <RunDetail runId={openRunId} canCancel={overview.canStart} onChanged={load} /> : null}
        </>
      ) : loadError ? null : (
        <p className="am-muted">Loading…</p>
      )}
    </main>
  );
}

function Setup({ overview }: { overview: Overview }) {
  const problems: Array<{ title: string; body: React.ReactNode }> = [];

  if (!overview.onshape.connected) {
    problems.push({
      title: "Connect Onshape",
      body: (
        <>
          <p>{overview.onshape.message}</p>
          <p>
            <a className="am-link" href="/cad/connections">
              Open CAD connections
            </a>
          </p>
        </>
      ),
    });
  }

  if (!overview.worker.lastCheckIn) {
    problems.push({
      title: "No worker has picked up a run yet",
      body: <p>{overview.worker.message}</p>,
    });
  }

  if (!problems.length) return null;

  return (
    <section className="am-setup" aria-label="Setup needed">
      {problems.map((problem) => (
        <div key={problem.title} className="am-setup-card">
          <h2>{problem.title}</h2>
          {problem.body}
        </div>
      ))}
    </section>
  );
}

function StartPanel({ overview, onStarted }: { overview: Overview; onStarted: (runId: string) => void }) {
  const [url, setUrl] = useState("");
  const [documentId, setDocumentId] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [choices, setChoices] = useState<StartResult | null>(null);

  const start = useCallback(
    async (elementId?: string) => {
      setBusy(true);
      setMessage(null);
      try {
        const response = await fetch("/api/assembly-manual", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            action: "start",
            ...(url.trim() ? { url: url.trim() } : {}),
            ...(documentId ? { documentId } : {}),
            ...(elementId ? { elementId } : {}),
          }),
        });
        const body = (await response.json()) as StartResult & { error?: string };
        if (!response.ok) throw new Error(body.error ?? "Could not start a run.");
        if (body.status === "queued") {
          setChoices(null);
          setMessage(`Queued. "${body.assemblyName}" will be built on your team's relay.`);
          onStarted(body.runId);
          return;
        }
        if (body.status === "choose_assembly") {
          setChoices(body);
          setMessage(body.message);
          return;
        }
        setChoices(null);
        setMessage(body.message);
      } catch (error) {
        setMessage(error instanceof Error ? error.message : "Could not start a run.");
      } finally {
        setBusy(false);
      }
    },
    [documentId, onStarted, url],
  );

  if (!overview.canStart) {
    return (
      <section className="am-card">
        <h2>Starting a run</h2>
        <p className="am-muted">
          A run spends Onshape API budget for the whole team, so owners and admins start them. Ask a lead, or
          open a finished run below.
        </p>
      </section>
    );
  }

  return (
    <section className="am-card">
      <h2>Build a manual</h2>

      {overview.vault.length ? (
        <label className="am-field">
          <span>From a CAD vault document</span>
          <select
            value={documentId}
            onChange={(event) => {
              setDocumentId(event.target.value);
              setUrl("");
              setChoices(null);
            }}
          >
            <option value="">Paste a link instead</option>
            {overview.vault.map((document) => (
              <option key={document.id} value={document.id}>
                {document.seasonYear} · {document.title}
              </option>
            ))}
          </select>
        </label>
      ) : (
        <p className="am-muted">
          No CAD vault document has an Onshape link on it yet, so paste the assembly URL here.
        </p>
      )}

      <label className="am-field">
        <span>Or paste the Onshape assembly link</span>
        <input
          type="url"
          placeholder="https://cad.onshape.com/documents/…/w/…/e/…"
          value={url}
          onChange={(event) => {
            setUrl(event.target.value);
            setDocumentId("");
            setChoices(null);
          }}
        />
      </label>

      <button
        type="button"
        className="am-primary"
        disabled={busy || (!url.trim() && !documentId)}
        onClick={() => void start()}
      >
        {busy ? "Starting…" : "Build the manual"}
      </button>

      {choices?.status === "choose_assembly" ? (
        <div className="am-choices">
          <p>Which assembly?</p>
          <ul>
            {choices.assemblies.map((assembly) => (
              <li key={assembly.id}>
                <button type="button" disabled={busy} onClick={() => void start(assembly.id)}>
                  {assembly.name}
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {message ? <p className="am-note">{message}</p> : null}

      <p className="am-muted am-fineprint">
        This runs on your team&rsquo;s relay, not in this page. A full robot is hours of Onshape calls, so the
        run checkpoints as it goes and picks up where it left off if the relay restarts. You can close this
        tab.
      </p>
    </section>
  );
}

function RunList({
  runs,
  openRunId,
  onOpen,
}: {
  runs: Run[];
  openRunId: string | null;
  onOpen: (runId: string) => void;
}) {
  if (!runs.length) {
    return (
      <section className="am-card">
        <h2>Runs</h2>
        <p className="am-muted">
          No manual has been built yet. Start one above and it will appear here with live progress.
        </p>
      </section>
    );
  }

  return (
    <section className="am-card">
      <h2>Runs</h2>
      <table className="am-table">
        <thead>
          <tr>
            <th>Assembly</th>
            <th>Status</th>
            <th>Progress</th>
            <th>Started</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {runs.map((run) => {
            const total = run.progress?.stepsTotal ?? 0;
            const rendered = run.progress?.rendersDone ?? 0;
            return (
              <tr key={run.id} className={run.id === openRunId ? "am-row-open" : undefined}>
                <td>
                  <strong>{run.assemblyName || "Assembly"}</strong>
                  <br />
                  <a className="am-link am-small" href={run.onshapeUrl} target="_blank" rel="noreferrer">
                    Open in Onshape
                  </a>
                </td>
                <td>
                  <span className={`am-status am-status-${run.status}`}>{run.status}</span>
                  {run.cancelRequestedAt && ACTIVE.includes(run.status) ? (
                    <div className="am-small am-muted">cancel requested</div>
                  ) : null}
                  {run.error ? <div className="am-small am-error-text">{run.error}</div> : null}
                </td>
                <td className="am-small">
                  {run.progress?.stage ? <div>{run.progress.stage}</div> : null}
                  {total ? (
                    <div>
                      {rendered} of {total} steps rendered
                    </div>
                  ) : null}
                  {run.progress?.note ? <div className="am-muted">{run.progress.note}</div> : null}
                </td>
                <td className="am-small">
                  {when(run.createdAt)}
                  {run.startedByName ? <div className="am-muted">{run.startedByName}</div> : null}
                </td>
                <td>
                  <button type="button" onClick={() => onOpen(run.id)}>
                    {run.id === openRunId ? "Viewing" : "Open"}
                  </button>
                  {run.status === "completed" && run.pdfByteSize ? (
                    <>
                      {" "}
                      <a className="am-link" href={`/api/assembly-manual/${run.id}/pdf`}>
                        PDF
                      </a>
                    </>
                  ) : null}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </section>
  );
}

function RunDetail({
  runId,
  canCancel,
  onChanged,
}: {
  runId: string;
  canCancel: boolean;
  onChanged: () => Promise<void> | void;
}) {
  const [run, setRun] = useState<Run | null>(null);
  const [steps, setSteps] = useState<Step[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [cursor, setCursor] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const limit = 40;

  const load = useCallback(async () => {
    try {
      const response = await fetch(`/api/assembly-manual/${runId}?offset=${offset}&limit=${limit}`, {
        cache: "no-store",
      });
      const body = (await response.json()) as {
        run: Run;
        steps: Step[];
        total: number;
        error?: string;
      };
      if (!response.ok) throw new Error(body.error ?? "Could not load that run.");
      setRun(body.run);
      setSteps(body.steps);
      setTotal(body.total);
      setError(null);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Could not load that run.");
    }
  }, [offset, runId]);

  useEffect(() => {
    setOffset(0);
    setCursor(0);
  }, [runId]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!run || !ACTIVE.includes(run.status)) return;
    const timer = setInterval(() => void load(), 5000);
    return () => clearInterval(timer);
  }, [load, run]);

  const cancel = useCallback(async () => {
    const response = await fetch(`/api/assembly-manual/${runId}`, { method: "DELETE" });
    const body = (await response.json()) as { message?: string; error?: string };
    setError(body.error ?? body.message ?? null);
    await load();
    await onChanged();
  }, [load, onChanged, runId]);

  if (error && !run) return <p className="am-error">{error}</p>;
  if (!run) return <p className="am-muted">Loading run…</p>;

  const step = steps[cursor] ?? null;
  const absoluteStep = offset + cursor + 1;

  return (
    <section className="am-card am-detail">
      <div className="am-detail-head">
        <h2>{run.assemblyName || "Assembly"}</h2>
        <div className="am-detail-actions">
          {run.status === "completed" && run.pdfByteSize ? (
            <a className="am-primary am-primary-link" href={`/api/assembly-manual/${runId}/pdf`}>
              Download PDF ({Math.round(run.pdfByteSize / 1024)} KB)
            </a>
          ) : null}
          {canCancel && ACTIVE.includes(run.status) && !run.cancelRequestedAt ? (
            <button type="button" onClick={() => void cancel()}>
              Cancel run
            </button>
          ) : null}
        </div>
      </div>

      {error ? <p className="am-note">{error}</p> : null}

      {ACTIVE.includes(run.status) ? (
        <p className="am-note">
          {run.progress?.note || "Waiting for a worker to pick this up."}
          {run.progress?.stepsTotal
            ? ` · ${run.progress.rendersDone ?? 0} of ${run.progress.stepsTotal} steps rendered`
            : ""}
        </p>
      ) : null}

      {run.status === "failed" && run.error ? <p className="am-error">{run.error}</p> : null}

      {steps.length ? (
        <>
          <div className="am-stepbar">
            <button type="button" disabled={absoluteStep <= 1} onClick={() => {
              if (cursor > 0) setCursor(cursor - 1);
              else if (offset > 0) {
                setOffset(Math.max(0, offset - limit));
                setCursor(limit - 1);
              }
            }}>
              Previous
            </button>
            <span>
              Step {absoluteStep} of {total}
            </span>
            <button type="button" disabled={absoluteStep >= total} onClick={() => {
              if (cursor + 1 < steps.length) setCursor(cursor + 1);
              else {
                setOffset(offset + limit);
                setCursor(0);
              }
            }}>
              Next
            </button>
          </div>

          {step ? <StepView runId={runId} step={step} /> : null}
        </>
      ) : (
        <p className="am-muted">
          No steps yet. They appear as soon as the build order has been worked out, before the renders start.
        </p>
      )}

      {run.report ? <ReportView report={run.report} /> : null}
    </section>
  );
}

function StepView({ runId, step }: { runId: string; step: Step }) {
  const failing = (step.feasibility?.checks ?? []).filter((check) => !check.passed);

  return (
    <article className="am-step">
      <div className="am-step-figure">
        {step.hasRender ? (
          // A plain <img>, not next/image: the source is a per-request, RLS-
          // guarded PNG out of Postgres, which the image optimiser can neither
          // cache nor fetch on the viewer's behalf.
          <img
            src={`/api/assembly-manual/${runId}/step/${step.stepNumber}`}
            alt={`Onshape render for step ${step.stepNumber}: ${step.title}`}
          />
        ) : (
          <div className="am-noshot">
            <strong>No render for this step</strong>
            <p>{step.renderNote || "Onshape returned no shaded view."}</p>
          </div>
        )}
        {step.renderNote && step.hasRender ? <p className="am-small am-muted">{step.renderNote}</p> : null}
      </div>

      <div className="am-step-body">
        {step.subassembly ? <p className="am-kicker">{step.subassembly}</p> : null}
        <h3>
          Step {step.stepNumber} · {step.title}
        </h3>
        <p className="am-sentence">{step.sentence}</p>
        {step.sentenceSource === "model" ? (
          <p className="am-small am-muted">Sentence phrased by the model from the facts below. No number in it comes from the model.</p>
        ) : null}

        {step.parts?.length ? (
          <>
            <h4>Parts</h4>
            <ul className="am-parts">
              {step.parts.map((part) => (
                <li key={`${part.name}-${part.quantity}`}>
                  <span className="am-qty">{part.quantity}&times;</span> {part.name}
                  {part.cots ? (
                    <span className="am-muted"> · {part.cots.vendor} {part.cots.sku}</span>
                  ) : part.extentMm?.length ? (
                    <span className="am-muted"> · {inches(part.extentMm[0]!)} long</span>
                  ) : null}
                </li>
              ))}
            </ul>
          </>
        ) : null}

        {step.fabrication?.length ? (
          <>
            <h4>Make</h4>
            <ul className="am-fab">
              {step.fabrication.map((line, index) => (
                <li key={`${line.kind}-${index}`} className={line.confirmed ? undefined : "am-unconfirmed"}>
                  {line.text}
                </li>
              ))}
            </ul>
          </>
        ) : null}

        {failing.length ? (
          <div className="am-warn">
            <h4>Check this step before you build it</h4>
            <ul>
              {failing.map((check) => (
                <li key={check.id}>{check.detail}</li>
              ))}
            </ul>
          </div>
        ) : null}

        {step.disagreement ? (
          <p className="am-small am-muted">
            The two ordering strategies disagreed here: the {step.disagreement.strategy} order puts this part
            at step {step.disagreement.otherPosition}.
          </p>
        ) : null}
      </div>
    </article>
  );
}

function ReportView({ report }: { report: Report }) {
  const modes = Object.entries(report.renderModes ?? {});
  return (
    <section className="am-report">
      <h3>How this manual was checked</h3>
      <ul className="am-report-facts">
        <li>
          Build order strategy used:{" "}
          <strong>{report.strategyUsed === "geometry" ? "geometry-first" : "mate dependency"}</strong>
        </li>
        <li>
          Feasibility checks: <strong>{report.checksPassed ?? 0}</strong> passed of{" "}
          <strong>{report.checksRun ?? 0}</strong> run
        </li>
        <li>
          The two ordering strategies disagreed on <strong>{report.disagreements?.length ?? 0}</strong> step(s)
        </li>
        <li>
          Still unresolved: <strong>{report.unresolved?.length ?? 0}</strong> step(s)
        </li>
        {report.onshapeCalls ? <li>Onshape calls made: {report.onshapeCalls}</li> : null}
        {modes.length ? (
          <li>
            Renders:{" "}
            {modes
              .map(([mode, count]) => `${count} ${mode.replace("_", " ")}`)
              .join(", ")}
          </li>
        ) : null}
        <li>
          Parts catalog:{" "}
          {report.cotsCatalog === "used"
            ? "used for hardware names"
            : "not installed, so hardware uses the CAD's own part names"}
        </li>
      </ul>

      {report.unresolved?.length ? (
        <div className="am-warn">
          <h4>Steps that still fail a check</h4>
          <ul>
            {report.unresolved.map((entry) => (
              <li key={entry.instanceId}>
                <strong>{entry.name}</strong> — {entry.reason}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {report.disagreements?.length ? (
        <details className="am-details">
          <summary>Where the two orders disagreed ({report.disagreements.length})</summary>
          <ul>
            {report.disagreements.map((entry) => (
              <li key={entry.instanceId}>
                <strong>{entry.name}</strong> — {entry.note}
              </li>
            ))}
          </ul>
        </details>
      ) : null}

      {report.notes?.length ? (
        <details className="am-details">
          <summary>Notes ({report.notes.length})</summary>
          <ul>
            {report.notes.map((note) => (
              <li key={note}>{note}</li>
            ))}
          </ul>
        </details>
      ) : null}

      {report.gaps?.length ? (
        <details className="am-details">
          <summary>What the CAD could not tell us ({report.gaps.length})</summary>
          <ul>
            {report.gaps.map((gap) => (
              <li key={gap}>{gap}</li>
            ))}
          </ul>
        </details>
      ) : null}

      {report.cutList?.length ? (
        <details className="am-details" open>
          <summary>Materials and cut list ({report.cutList.length})</summary>
          <table className="am-table">
            <thead>
              <tr>
                <th>Part</th>
                <th>Qty</th>
                <th>Length</th>
                <th>Section</th>
                <th>Material</th>
              </tr>
            </thead>
            <tbody>
              {report.cutList.map((row) => (
                <tr key={row.partName} className={row.lengthConfirmed ? undefined : "am-unconfirmed-row"}>
                  <td>{row.partName}</td>
                  <td>{row.quantity}</td>
                  <td>
                    {row.lengthMm === null ? "—" : inches(row.lengthMm)}
                    {row.lengthConfirmed ? null : (
                      <div className="am-small am-muted">confirm — not specified in CAD</div>
                    )}
                  </td>
                  <td>{row.profile ?? "—"}</td>
                  <td>{row.material ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </details>
      ) : null}

      {report.hardware?.length ? (
        <details className="am-details">
          <summary>Hardware ({report.hardware.length})</summary>
          <ul>
            {report.hardware.map((row) => (
              <li key={row.partName}>
                {row.quantity}&times; {row.partName}
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </section>
  );
}
