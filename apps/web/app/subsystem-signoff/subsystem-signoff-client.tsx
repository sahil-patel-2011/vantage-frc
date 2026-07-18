"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { BuildHubRelated } from "../../components/build-hub-related";
import { EmptyState, FormGrid, FormRow, PageHeader, Panel } from "../../components/ui";
import { hubHref } from "../../lib/nav/hubs";
import { withOrgHref } from "../../lib/nav/product-nav";
import {
  SIGNOFF_DECISIONS,
  SIGNOFF_GATES,
  SUBSYSTEM_CATEGORIES,
  SUBSYSTEM_STATUSES,
  signoffGateLabel,
  subsystemCategoryLabel,
  subsystemStatusLabel,
} from "../../lib/subsystem-signoff";
import type { SubsystemSignoffView } from "../../lib/subsystem-signoff/compute-subsystem-signoff";
import {
  SIGNOFF_BUILD_RELATED_INCLUDE,
  formatSignoffReadinessDisplay,
  formatSubsystemCompletionDisplay,
  shouldShowSignoffSummaryTiles,
  signoffNextActions,
  signoffRelatedLinks,
  signoffTierTone,
} from "../../lib/subsystem-signoff/subsystem-signoff-related";
import type {
  SignoffDecision,
  SignoffGate,
  SubsystemCategory,
  SubsystemScore,
  SubsystemStatus,
} from "../../lib/subsystem-signoff/types";
import "./subsystem-signoff.css";

type LiveView = Extract<SubsystemSignoffView, { status: "live" }>;
type Mutate = (payload: Record<string, unknown>) => void;

function SignoffRelated({ orgId }: { orgId: string }) {
  const primary = signoffRelatedLinks(orgId, { include: ["fmea", "cad", "tasks"] });
  return (
    <div className="signoff-related">
      <nav className="product-hub-related signoff-hub-related" aria-label="Related build tools">
        {primary.map((link) => (
          <a key={link.id} className="app-button secondary" href={link.href}>
            {link.label}
          </a>
        ))}
      </nav>
      <BuildHubRelated orgId={orgId} include={[...SIGNOFF_BUILD_RELATED_INCLUDE]} />
    </div>
  );
}

function NextActions({
  orgId,
  subsystemCount,
  startedCount,
  signedOffCount,
  blockedCount,
  pendingGates,
  topTitle,
}: {
  orgId?: string | null;
  subsystemCount: number;
  startedCount: number;
  signedOffCount: number;
  blockedCount: number;
  pendingGates: number;
  topTitle?: string | null;
}) {
  const actions = signoffNextActions({
    orgId,
    subsystemCount,
    startedCount,
    signedOffCount,
    blockedCount,
    pendingGates,
    topTitle,
  });
  return (
    <section className="signoff-next-actions app-card soft-panel" aria-label="Next actions">
      <header>
        <h2>Next actions</h2>
        <p>Prioritized from recorded gate reviews — readiness stays blank until you approve or reject a gate.</p>
      </header>
      <ol>
        {actions.map((action) => (
          <li key={action.id} className={action.primary ? "primary" : undefined}>
            <div>
              <strong>{action.label}</strong>
              <span>{action.detail}</span>
            </div>
            <a className="app-button secondary" href={action.href}>
              Open
            </a>
          </li>
        ))}
      </ol>
    </section>
  );
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function statusBadgeClass(status: SubsystemStatus): string {
  return `signoff-badge ${status}`;
}

function gateBadgeClass(decision: SignoffDecision | null): string {
  if (decision === "approved") return "signoff-badge approved";
  if (decision === "rejected") return "signoff-badge rejected";
  return "signoff-badge pending";
}

export default function SubsystemSignoffClient() {
  const [view, setView] = useState<SubsystemSignoffView | null>(null);
  const [error, setError] = useState("");
  const [fetchFailed, setFetchFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [season, setSeason] = useState<number | null>(null);

  const orgId = view && "orgId" in view ? view.orgId : null;

  const load = useCallback((seasonOverride?: number) => {
    setFetchFailed(false);
    setError("");
    const params = new URLSearchParams(window.location.search);
    const urlOrg = params.get("orgId");
    const seasonQuery = seasonOverride ?? (params.get("season") ? Number(params.get("season")) : null);
    const query = new URLSearchParams();
    if (urlOrg) query.set("orgId", urlOrg);
    if (seasonQuery) query.set("season", String(seasonQuery));
    void fetch(`/api/subsystem-signoff${query.toString() ? `?${query.toString()}` : ""}`)
      .then(async (response) => {
        const data = (await response.json()) as SubsystemSignoffView | { error?: string };
        if (!response.ok || !("status" in data)) {
          setFetchFailed(true);
          return;
        }
        setView(data);
        setSeason(data.seasonYear);
      })
      .catch(() => setFetchFailed(true));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const mutate = useCallback<Mutate>(
    (payload) => {
      if (!orgId || busy) return;
      setBusy(true);
      setError("");
      void fetch("/api/subsystem-signoff", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ orgId, seasonYear: season ?? undefined, ...payload }),
      })
        .then(async (response) => {
          const data = (await response.json()) as SubsystemSignoffView | { error?: string };
          if (!response.ok || !("status" in data)) {
            setError("error" in data && data.error ? data.error : "Something went wrong.");
            return;
          }
          setView(data);
          setSeason(data.seasonYear);
        })
        .catch(() => setError("Network error — please try again."))
        .finally(() => setBusy(false));
    },
    [orgId, season, busy],
  );

  if (fetchFailed || view == null) {
    return (
      <main className="module-page signoff-page">
        <PageHeader
          breadcrumbs="Build / Subsystem Sign-off"
          title="Subsystem Sign-off"
          description="Track each robot subsystem through its review gates — readiness comes only from recorded approve/reject decisions."
        />
        <EmptyState
          soft
          title={fetchFailed ? "Could not load subsystem sign-offs" : "Loading subsystem sign-offs…"}
          description={
            fetchFailed
              ? "A network or server issue prevented loading. Try again."
              : "Checking your workspace."
          }
          aria-busy={!fetchFailed}
        >
          {fetchFailed ? (
            <button type="button" className="app-button secondary" onClick={() => load()}>
              Retry
            </button>
          ) : null}
        </EmptyState>
      </main>
    );
  }

  if (view.status === "setup_required") {
    return (
      <main className="module-page signoff-page">
        <PageHeader
          breadcrumbs="Build / Subsystem Sign-off"
          title="Subsystem Sign-off"
          description="Clear design through field-test gates with an auditable trail — readiness % stays blank until real decisions exist."
        />
        <EmptyState soft badge="Setup required" badgeTone="setup" title={view.message}>
          <ol className="signoff-setup-steps">
            {view.steps.map((step) => (
              <li key={step.id}>
                <div>
                  <strong>{step.label}</strong>
                  <span>{step.detail}</span>
                </div>
                <a className="app-button secondary" href={step.href}>
                  Open
                </a>
              </li>
            ))}
          </ol>
        </EmptyState>
        <NextActions
          orgId={view.orgId}
          subsystemCount={0}
          startedCount={0}
          signedOffCount={0}
          blockedCount={0}
          pendingGates={0}
        />
      </main>
    );
  }

  const hasSubsystems = view.summary.totalSubsystems > 0;
  const pendingGates = Math.max(0, view.summary.totalGates - view.summary.approvedGates);
  const topTitle =
    view.summary.subsystemScores.find((s) => s.subsystem.status === "blocked")?.subsystem.name ??
    view.summary.subsystemScores.find((s) => !s.fullyApproved)?.subsystem.name ??
    null;

  return (
    <main className="module-page signoff-page">
      <PageHeader
        breadcrumbs={
          <>
            <a href={orgId ? withOrgHref("/build", orgId) : "/build"}>Build</a>
            {" / Subsystem Sign-off"}
          </>
        }
        title="Subsystem Sign-off"
        description={
          <>
            Walk each subsystem through design, fabrication, assembly, wiring, programming, and field
            test. Readiness reflects only recorded gate decisions — never a demo percentage.
          </>
        }
      >
        <div className="signoff-header-actions">
          {view.seasons.length > 0 ? (
            <label className="app-muted" style={{ display: "flex", gap: 6, alignItems: "center" }}>
              Season
              <select
                value={season ?? view.seasonYear}
                onChange={(event) => {
                  const next = Number(event.target.value);
                  setSeason(next);
                  load(next);
                }}
              >
                {view.seasons.map((year) => (
                  <option key={year} value={year}>
                    {year}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          <a className="app-button secondary" href={hubHref("/build", "fmea", orgId)}>
            FMEA
          </a>
          <a className="app-button secondary" href={hubHref("/build", "cad", orgId)}>
            CAD
          </a>
          <a className="app-button secondary" href={withOrgHref("/tasks", orgId)}>
            Tasks
          </a>
        </div>
      </PageHeader>

      {orgId ? <SignoffRelated orgId={orgId} /> : null}

      {error ? (
        <p className="signoff-alert" role="alert">
          {error}
        </p>
      ) : null}

      <NextActions
        orgId={orgId}
        subsystemCount={view.summary.totalSubsystems}
        startedCount={view.summary.startedSubsystems}
        signedOffCount={view.summary.signedOffSubsystems}
        blockedCount={view.summary.blockedSubsystems}
        pendingGates={pendingGates}
        topTitle={topTitle}
      />

      <ReadinessPanel view={view} />
      {shouldShowSignoffSummaryTiles(view.summary.totalSubsystems) ? <SummaryTiles view={view} /> : null}

      <AddSubsystemForm busy={busy} mutate={mutate} />

      {!hasSubsystems ? (
        <EmptyState
          soft
          badge="No subsystems yet"
          badgeTone="setup"
          title="Add your first robot subsystem"
          description="Drivetrain, intake, scoring, climber — each clears the same review gates. Readiness stays blank until someone records a real approve or reject."
        >
          <div className="signoff-row-links">
            <a href={hubHref("/build", "fmea", orgId)}>FMEA →</a>
            <a href={hubHref("/build", "cad", orgId)}>CAD →</a>
            <a href={withOrgHref("/tasks", orgId)}>Tasks →</a>
            <a href={withOrgHref("/subsystems", orgId)}>Subsystem specs →</a>
          </div>
        </EmptyState>
      ) : (
        <SubsystemBoard view={view} busy={busy} mutate={mutate} />
      )}
    </main>
  );
}

function ReadinessPanel({ view }: { view: LiveView }) {
  const { readiness, summary } = view;
  const display = formatSignoffReadinessDisplay(readiness.score, {
    subsystemCount: summary.totalSubsystems,
    startedCount: summary.startedSubsystems,
  });
  const emptyScore = display === "—";

  return (
    <Panel className="signoff-readiness" aria-label="Competition sign-off readiness">
      <header>
        <div>
          <span className={`app-badge ${signoffTierTone(readiness.tier)}`}>
            {readiness.tier.replace("_", " ").toUpperCase()}
          </span>
          <h2>Competition sign-off readiness</h2>
          <small className="app-muted">
            {summary.totalSubsystems === 0
              ? "No subsystems yet — % stays blank until gate decisions exist."
              : summary.startedSubsystems === 0
                ? `${summary.totalSubsystems} subsystem(s) listed · no gate decisions recorded yet`
                : `${readiness.subsystemsFullyApproved} of ${summary.totalSubsystems} subsystem(s) fully signed off`}
          </small>
        </div>
        <div className={`score${emptyScore ? " empty" : ""}`}>
          <em>Ready</em>
          <strong>{display}</strong>
        </div>
      </header>
      {readiness.recommendations.length > 0 ? (
        <ul className="signoff-recs">
          {readiness.recommendations.map((rec) => (
            <li key={rec}>{rec}</li>
          ))}
        </ul>
      ) : null}
    </Panel>
  );
}

function SummaryTiles({ view }: { view: LiveView }) {
  const { summary } = view;
  const tiles = [
    { label: "Subsystems", value: String(summary.totalSubsystems), tone: "" },
    {
      label: "Signed off",
      value: String(summary.signedOffSubsystems),
      tone: summary.signedOffSubsystems > 0 ? "good" : "",
    },
    {
      label: "Blocked",
      value: String(summary.blockedSubsystems),
      tone: summary.blockedSubsystems > 0 ? "warn" : "",
    },
    {
      label: "Gates approved",
      value: summary.startedSubsystems > 0 ? `${summary.approvedGates} / ${summary.totalGates}` : "—",
      tone: "",
    },
  ];
  return (
    <Panel>
      <section className="signoff-summary" aria-label="Sign-off summary">
        {tiles.map((tile) => (
          <article key={tile.label} className={`signoff-summary-tile${tile.tone ? ` ${tile.tone}` : ""}`}>
            <strong>{tile.value}</strong>
            <span>{tile.label}</span>
          </article>
        ))}
      </section>
    </Panel>
  );
}

function SubsystemBoard({
  view,
  busy,
  mutate,
}: {
  view: LiveView;
  busy: boolean;
  mutate: Mutate;
}) {
  return (
    <div className="signoff-list">
      {view.summary.subsystemScores.map((score) => (
        <SubsystemCard key={score.subsystemId} score={score} busy={busy} mutate={mutate} />
      ))}
    </div>
  );
}

function SubsystemCard({
  score,
  busy,
  mutate,
}: {
  score: SubsystemScore;
  busy: boolean;
  mutate: Mutate;
}) {
  const { subsystem } = score;
  const [gate, setGate] = useState<SignoffGate>("design");
  const [decision, setDecision] = useState<SignoffDecision>("approved");
  const [signedOn, setSignedOn] = useState(todayIso());
  const [notes, setNotes] = useState("");
  const completionDisplay = formatSubsystemCompletionDisplay(
    score.completion,
    score.approvedGates,
    score.rejectedGates,
  );

  return (
    <article className={`signoff-card ${subsystem.status}`}>
      <header className="signoff-card-top">
        <div className="signoff-card-title">
          <span className={statusBadgeClass(subsystem.status)}>{subsystemStatusLabel(subsystem.status)}</span>
          <h2>{subsystem.name}</h2>
          <span className="signoff-card-meta">
            {subsystemCategoryLabel(subsystem.category)} · {score.approvedGates}/{score.gatesTotal} gates
            approved · {completionDisplay}
          </span>
          {subsystem.notes ? <span className="signoff-card-meta">{subsystem.notes}</span> : null}
        </div>
        <div className="signoff-card-actions">
          <label>
            Status
            <select
              value={subsystem.status}
              disabled={busy}
              onChange={(event) =>
                mutate({ action: "update-status", subsystemId: subsystem.id, status: event.target.value })
              }
            >
              {SUBSYSTEM_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {subsystemStatusLabel(s)}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            className="text-button"
            disabled={busy}
            onClick={() => {
              if (window.confirm(`Delete "${subsystem.name}" and its sign-offs?`)) {
                mutate({ action: "delete-subsystem", subsystemId: subsystem.id });
              }
            }}
          >
            Delete
          </button>
        </div>
      </header>

      <ul className="signoff-gates" aria-label={`${subsystem.name} gates`}>
        {score.gates.map((g) => (
          <li key={g.gate}>
            <span className="gate-name">{signoffGateLabel(g.gate)}</span>
            <span className={gateBadgeClass(g.decision)}>
              {g.decision === "approved"
                ? `Approved · ${g.signedOn}`
                : g.decision === "rejected"
                  ? `Rejected · ${g.signedOn}`
                  : "Pending — no decision yet"}
            </span>
          </li>
        ))}
      </ul>

      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (!signedOn) return;
          mutate({
            action: "record-signoff",
            subsystemId: subsystem.id,
            gate,
            decision,
            signedOn,
            notes: notes || undefined,
          });
          setNotes("");
        }}
        className="signoff-panel"
      >
        <h2>Record sign-off</h2>
        <p>Approve or reject one gate from a real review. Later decisions replace earlier ones on the same gate.</p>
        <FormGrid min={140}>
          <FormRow label="Gate">
            <select value={gate} onChange={(event) => setGate(event.target.value as SignoffGate)}>
              {SIGNOFF_GATES.map((g) => (
                <option key={g} value={g}>
                  {signoffGateLabel(g)}
                </option>
              ))}
            </select>
          </FormRow>
          <FormRow label="Decision">
            <select value={decision} onChange={(event) => setDecision(event.target.value as SignoffDecision)}>
              {SIGNOFF_DECISIONS.map((d) => (
                <option key={d} value={d}>
                  {d === "approved" ? "Approve" : "Reject"}
                </option>
              ))}
            </select>
          </FormRow>
          <FormRow label="Date">
            <input type="date" value={signedOn} onChange={(event) => setSignedOn(event.target.value)} required />
          </FormRow>
          <FormRow label="Notes (optional)">
            <input value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="Reviewer note" />
          </FormRow>
        </FormGrid>
        <div className="signoff-form-actions">
          <button type="submit" className="app-button secondary" disabled={busy || !signedOn}>
            Record sign-off
          </button>
        </div>
      </form>
    </article>
  );
}

function AddSubsystemForm({ busy, mutate }: { busy: boolean; mutate: Mutate }) {
  const empty = useMemo(
    () => ({ name: "", category: "drivetrain" as SubsystemCategory, notes: "" }),
    [],
  );
  const [form, setForm] = useState(empty);
  const set = (key: keyof typeof form) => (event: { target: { value: string } }) =>
    setForm((prev) => ({ ...prev, [key]: event.target.value }));

  return (
    <Panel
      as="form"
      className="signoff-panel"
      onSubmit={(event) => {
        event.preventDefault();
        if (!form.name.trim()) return;
        mutate({
          action: "add-subsystem",
          name: form.name,
          category: form.category,
          notes: form.notes || undefined,
        });
        setForm(empty);
      }}
    >
      <h2>Add subsystem</h2>
      <p>List each mechanism you need signed off before competition. Specs (motors, gearing) live on Subsystem specs.</p>
      <FormGrid min={160}>
        <FormRow label="Name">
          <input value={form.name} onChange={set("name")} placeholder="Drivetrain" required />
        </FormRow>
        <FormRow label="Category">
          <select value={form.category} onChange={set("category")}>
            {SUBSYSTEM_CATEGORIES.map((category) => (
              <option key={category} value={category}>
                {subsystemCategoryLabel(category)}
              </option>
            ))}
          </select>
        </FormRow>
      </FormGrid>
      <FormRow label="Notes (optional)">
        <textarea value={form.notes} onChange={set("notes")} rows={2} />
      </FormRow>
      <div className="signoff-form-actions">
        <button type="submit" className="app-button" disabled={busy || !form.name.trim()}>
          Add subsystem
        </button>
      </div>
    </Panel>
  );
}
