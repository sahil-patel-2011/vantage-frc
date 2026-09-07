"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { EmptyState, FormGrid, FormRow, PageHeader, Panel } from "../../components/ui";
import { classifyLoadFailure, loadFailureCopy } from "../../lib/ui/load-failure";
import { leadershipCategoryLabel, leadershipHandoffStatusLabel } from "../../lib/leadership";
import {
  LEADERSHIP_CATEGORY_VALUES,
  LEADERSHIP_STATUS_VALUES,
  type LeadershipView,
} from "../../lib/leadership/compute-leadership";
import type { LeadershipCategory, LeadershipHandoffStatus, LeadershipTier } from "../../lib/leadership/types";

function tierTone(tier: LeadershipTier): string {
  if (tier === "resilient") return "good";
  if (tier === "developing") return "setup";
  return "demo";
}

function pct(value: number): string {
  return `${Math.round(value * 100)}%`;
}

type LiveView = Extract<LeadershipView, { status: "live" }>;

export default function LeadershipClient() {
  const [view, setView] = useState<LeadershipView | null>(null);
  const [error, setError] = useState("");
  const [fetchFailed, setFetchFailed] = useState(false);
  // Kept so an expired session offers sign-in instead of a Retry that cannot work.
  const [errorStatus, setErrorStatus] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [season, setSeason] = useState<number | null>(null);

  const orgId = view && "orgId" in view ? view.orgId : null;

  const load = useCallback((seasonOverride?: number) => {
    setFetchFailed(false);
    setErrorStatus(null);
    setError("");
    const params = new URLSearchParams(window.location.search);
    const urlOrg = params.get("orgId");
    const seasonQuery = seasonOverride ?? (params.get("season") ? Number(params.get("season")) : null);
    const query = new URLSearchParams();
    if (urlOrg) query.set("orgId", urlOrg);
    if (seasonQuery) query.set("season", String(seasonQuery));
    void fetch(`/api/leadership${query.toString() ? `?${query.toString()}` : ""}`)
      .then(async (response) => {
        const data = (await response.json()) as LeadershipView | { error?: string };
        if (!response.ok || !("status" in data)) {
          setErrorStatus(response.status);
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

  const mutate = useCallback(
    async (payload: Record<string, unknown>) => {
      if (!orgId || busy) return;
      setBusy(true);
      setError("");
      try {
        const response = await fetch("/api/leadership", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ orgId, seasonYear: season ?? undefined, ...payload }),
        });
        const data = (await response.json()) as LeadershipView | { error?: string };
        if (!response.ok || !("status" in data)) {
          setError("error" in data && data.error ? data.error : "Something went wrong.");
          return;
        }
        setView(data);
        setSeason(data.seasonYear);
      } catch {
        setError("Network error — please try again.");
      } finally {
        setBusy(false);
      }
    },
    [orgId, season, busy],
  );

  return (
    <main className="module-page">
      <PageHeader
        breadcrumbs={
          <>
            <a href={orgId ? `/team?orgId=${encodeURIComponent(orgId)}` : "/team"}>Team</a>
            {" / Leadership Continuity"}
          </>
        }
        title="Leadership Continuity"
        description="Succession planning and role handoffs — track each role's holder, successor, and handoff status. Readiness uses only what you record."
      >
        {view?.status === "live" && view.seasons.length > 0 ? (
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
      </PageHeader>

      {error ? (
        <p className="telemetry-status" role="alert">
          {error}
        </p>
      ) : null}

      {fetchFailed ? (
        (() => {
          const kind = classifyLoadFailure({
            status: errorStatus,
            message: error,
            online: typeof navigator === "undefined" ? true : navigator.onLine,
          });
          const copy = loadFailureCopy(kind, {
            nextPath:
              typeof window === "undefined"
                ? null
                : `${window.location.pathname}${window.location.search}`,
            message: error,
          });
          return (
            <EmptyState title={copy.title} description={copy.description}>
              {copy.primary ? (
                <a className="app-button" href={copy.primary.href}>
                  {copy.primary.label}
                </a>
              ) : null}
              {copy.showRetry ? (
                <button type="button" className="app-button secondary" onClick={() => load()}>
                  Retry
                </button>
              ) : null}
            </EmptyState>
          );
        })()
      ) : view == null ? (
        <EmptyState title="Loading…" description="Checking your workspace." aria-busy />
      ) : view.status === "setup_required" ? (
        <EmptyState badge="Setup required" badgeTone="setup" title={view.message}>
          <ol className="strategy-setup-steps">
            {view.steps.map((step) => (
              <li key={step.id}>
                <div>
                  <strong>{step.label}</strong>
                  <span>{step.detail}</span>
                </div>
                <a href={step.href} aria-label={`Open ${step.label}`}>Open</a>
              </li>
            ))}
          </ol>
        </EmptyState>
      ) : (
        <div style={{ display: "grid", gap: 16 }}>
          <ReadinessPanel view={view} />
          <SummaryTiles view={view} />
          <CreateRoleForm busy={busy} mutate={mutate} />
          <RoleBoard view={view} busy={busy} mutate={mutate} />
        </div>
      )}
    </main>
  );
}

function ReadinessPanel({ view }: { view: LiveView }) {
  const { readiness } = view;
  return (
    <Panel aria-label="Leadership continuity readiness">
      <header style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
        <div>
          <span className={`app-badge ${tierTone(readiness.tier)}`}>{readiness.tier.replace("_", " ").toUpperCase()}</span>
          <h2 style={{ margin: "6px 0 0" }}>Succession coverage</h2>
          <small className="app-muted">
            {view.summary.withSuccessor} of {view.summary.totalRoles} role(s) have an identified successor
          </small>
        </div>
        <strong style={{ fontSize: "2rem" }}>{pct(readiness.score)}</strong>
      </header>
      <div style={{ display: "grid", gap: 8, marginTop: 12 }}>
        <div style={{ display: "grid", gridTemplateColumns: "160px 1fr 48px", gap: 8, alignItems: "center" }}>
          <span className="app-muted">Successor coverage</span>
          <span className="mini-probability" aria-hidden="true">
            <i style={{ width: `${Math.max(2, readiness.coverage * 100)}%` }} />
          </span>
          <small className="app-muted" style={{ textAlign: "right" }}>{pct(readiness.coverage)}</small>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "160px 1fr 48px", gap: 8, alignItems: "center" }}>
          <span className="app-muted">Handoff progress</span>
          <span className="mini-probability" aria-hidden="true">
            <i style={{ width: `${Math.max(2, readiness.progress * 100)}%` }} />
          </span>
          <small className="app-muted" style={{ textAlign: "right" }}>{pct(readiness.progress)}</small>
        </div>
      </div>
      {readiness.recommendations.length > 0 ? (
        <div style={{ marginTop: 12 }}>
          <strong className="app-muted">Next steps</strong>
          <ul style={{ margin: "4px 0 0", paddingLeft: 18 }}>
            {readiness.recommendations.map((rec) => (
              <li key={rec}>{rec}</li>
            ))}
          </ul>
        </div>
      ) : null}
    </Panel>
  );
}

function SummaryTiles({ view }: { view: LiveView }) {
  const { summary } = view;
  const tiles = [
    { label: "Roles tracked", value: String(summary.totalRoles) },
    { label: "With successor", value: String(summary.withSuccessor) },
    { label: "Without successor", value: String(summary.withoutSuccessor) },
    { label: "Continuity score", value: pct(summary.continuityScore) },
  ];
  return (
    <Panel>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))", gap: 12 }}>
        {tiles.map((tile) => (
          <div key={tile.label}>
            <strong style={{ fontSize: "1.6rem", display: "block" }}>{tile.value}</strong>
            <span className="app-muted">{tile.label}</span>
          </div>
        ))}
      </div>
    </Panel>
  );
}

function RoleBoard({
  view,
  busy,
  mutate,
}: {
  view: LiveView;
  busy: boolean;
  mutate: (payload: Record<string, unknown>) => void;
}) {
  if (view.summary.totalRoles === 0) {
    return (
      <EmptyState
        badge="No roles yet"
        badgeTone="setup"
        title="Add your first leadership role"
        description="Officer positions, subsystem leads, mentors — track who holds each role and who's next."
      />
    );
  }
  return (
    <Panel>
      <h2 style={{ marginTop: 0 }}>Role handoff board</h2>
      <ul style={{ listStyle: "none", padding: 0, display: "grid", gap: 10 }}>
        {view.roles.map((role) => (
          <li
            key={role.id}
            style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "flex-start", flexWrap: "wrap" }}
          >
            <div>
              <strong>{role.roleTitle}</strong>
              <small className="app-muted" style={{ display: "block" }}>
                {leadershipCategoryLabel(role.category)} · Holder: {role.holderName}
              </small>
              <small className="app-muted">
                Successor: {role.successorName || "not identified"}
                {role.targetHandoffDate ? ` · target ${role.targetHandoffDate}` : ""}
              </small>
            </div>
            <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
              <select
                value={role.handoffStatus}
                disabled={busy}
                onChange={(event) =>
                  mutate({
                    action: "update-status",
                    roleId: role.id,
                    handoffStatus: event.target.value,
                    successorName: role.successorName,
                  })
                }
              >
                {LEADERSHIP_STATUS_VALUES.map((status) => (
                  <option key={status} value={status}>
                    {leadershipHandoffStatusLabel(status)}
                  </option>
                ))}
              </select>
              <button
                type="button"
                className="text-button"
                disabled={busy}
                onClick={() => {
                  if (window.confirm(`Delete "${role.roleTitle}"?`)) {
                    mutate({ action: "delete-role", roleId: role.id });
                  }
                }}
              >
                Delete
              </button>
            </div>
          </li>
        ))}
      </ul>
    </Panel>
  );
}

function CreateRoleForm({
  busy,
  mutate,
}: {
  busy: boolean;
  mutate: (payload: Record<string, unknown>) => void;
}) {
  const empty = useMemo(
    () => ({
      roleTitle: "",
      category: "leadership" as LeadershipCategory,
      holderName: "",
      successorName: "",
      handoffStatus: "not_started" as LeadershipHandoffStatus,
      targetHandoffDate: "",
      notes: "",
    }),
    [],
  );
  const [form, setForm] = useState(empty);
  const set = (key: keyof typeof form) => (event: { target: { value: string } }) =>
    setForm((prev) => ({ ...prev, [key]: event.target.value }));

  return (
    <Panel
      as="form"
      onSubmit={(event) => {
        event.preventDefault();
        if (!form.roleTitle.trim() || !form.holderName.trim()) return;
        mutate({
          action: "create-role",
          roleTitle: form.roleTitle,
          category: form.category,
          holderName: form.holderName,
          successorName: form.successorName || undefined,
          handoffStatus: form.handoffStatus,
          targetHandoffDate: form.targetHandoffDate || undefined,
          notes: form.notes || undefined,
        });
        setForm(empty);
      }}
      style={{ display: "grid", gap: 10 }}
    >
      <h2 style={{ margin: 0 }}>Add role</h2>
      <FormGrid min={160}>
        <FormRow label="Role title">
          <input value={form.roleTitle} onChange={set("roleTitle")} placeholder="Drivetrain lead" required />
        </FormRow>
        <FormRow label="Category">
          <select value={form.category} onChange={set("category")}>
            {LEADERSHIP_CATEGORY_VALUES.map((category) => (
              <option key={category} value={category}>
                {leadershipCategoryLabel(category)}
              </option>
            ))}
          </select>
        </FormRow>
        <FormRow label="Current holder">
          <input value={form.holderName} onChange={set("holderName")} placeholder="Name" required />
        </FormRow>
        <FormRow label="Successor (optional)">
          <input value={form.successorName} onChange={set("successorName")} placeholder="Name" />
        </FormRow>
        <FormRow label="Handoff status">
          <select value={form.handoffStatus} onChange={set("handoffStatus")}>
            {LEADERSHIP_STATUS_VALUES.map((status) => (
              <option key={status} value={status}>
                {leadershipHandoffStatusLabel(status)}
              </option>
            ))}
          </select>
        </FormRow>
        <FormRow label="Target handoff date (optional)">
          <input type="date" value={form.targetHandoffDate} onChange={set("targetHandoffDate")} />
        </FormRow>
      </FormGrid>
      <FormRow label="Notes (optional)">
        <textarea value={form.notes} onChange={set("notes")} rows={2} />
      </FormRow>
      <div>
        <button type="submit" className="app-button" disabled={busy || !form.roleTitle.trim() || !form.holderName.trim()}>
          Add role
        </button>
      </div>
    </Panel>
  );
}
