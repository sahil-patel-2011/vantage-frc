"use client";

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { EmptyState, FormGrid, FormRow, PageHeader, Panel, Button } from "../../components/ui";
import { scrimDataShareLabel, scrimStatusLabel } from "../../lib/cross-team-scrim";
import {
  SCRIM_DATA_SHARE_SCOPES,
  SCRIM_STATUSES,
  type CrossTeamScrimView,
} from "../../lib/cross-team-scrim/compute-cross-team-scrim";
import {
  CROSS_TEAM_SCRIM_RELATED_INCLUDE,
  classifyCrossTeamScrimShell,
  crossTeamScrimNextActions,
  crossTeamScrimRelatedLinks,
  crossTeamScrimSetupSteps,
  crossTeamScrimShellCopy,
  formatCrossTeamScrimMetric,
  shouldShowCrossTeamScrimSummaryTiles,
  type CrossTeamScrimNextAction,
  type CrossTeamScrimShellKind,
} from "../../lib/cross-team-scrim/cross-team-scrim-related";
import type { ScrimDataShareScope, ScrimStatus } from "../../lib/cross-team-scrim/types";
import { hubWorkbenchHref } from "../../lib/nav/hubs";
import { FEATURE_API_TIMEOUT_MS } from "../../lib/nav/resolve-org";
import "./cross-team-scrim.css";

function statusTone(status: ScrimStatus): string {
  if (status === "completed" || status === "accepted" || status === "scheduled") return "good";
  if (status === "proposed") return "setup";
  return "danger";
}

type LiveView = Extract<CrossTeamScrimView, { status: "live" }>;

function ScrimRelatedStrip({ orgId }: { orgId?: string | null }) {
  const links = crossTeamScrimRelatedLinks(orgId, {
    include: [...CROSS_TEAM_SCRIM_RELATED_INCLUDE],
  });
  if (!links.length) return null;
  return (
    <nav className="product-hub-related cross-team-scrim-related" aria-label="Related team tools">
      {links.map((link) => (
        <Button as="a" variant="secondary" key={link.id} href={link.href}>
          {link.label}
        </Button>
      ))}
    </nav>
  );
}

function ScrimNextActionsPanel({ actions }: { actions: CrossTeamScrimNextAction[] }) {
  if (!actions.length) return null;
  return (
    <section
      className="app-card soft-panel edc-next-actions cross-team-scrim-next-actions"
      aria-label="Next actions"
    >
      <header>
        <h2>Next actions</h2>
        <p className="app-muted">Each one opens the page where you finish the work.</p>
      </header>
      <ol>
        {actions.map((action) => (
          <li key={action.id} className={action.primary ? "primary" : undefined}>
            <div>
              <strong>{action.label}</strong>
              <span>{action.detail}</span>
            </div>
            <Button as="a" variant="secondary" href={action.href}>
              Open
            </Button>
          </li>
        ))}
      </ol>
    </section>
  );
}

function ScrimShell({
  description,
  orgId,
  shell,
  error,
  onRetry,
  children,
}: {
  description: string;
  orgId?: string | null;
  shell: CrossTeamScrimShellKind;
  error?: string;
  onRetry?: () => void;
  children?: ReactNode;
}) {
  const actions = crossTeamScrimNextActions({ orgId, shell });
  const copy = crossTeamScrimShellCopy(shell);
  const teamHref = hubWorkbenchHref("team", "cross-team-scrim", orgId);
  const setup = shell === "setup" ? crossTeamScrimSetupSteps(orgId)[0] : null;

  return (
    <main className="module-page cross-team-scrim-page soft-gate">
      <PageHeader
        breadcrumbs={
          <>
            <a href={teamHref}>Team</a>
            {" / Cross-Team Scrims"}
          </>
        }
        title="Cross-Team Scrim Scheduling"
        description={description}
      >
        <ScrimRelatedStrip orgId={orgId} />
      </PageHeader>
      {children}
      <EmptyState
        soft
        badge={
          shell === "setup"
            ? "Setup required"
            : shell === "error"
              ? "Unavailable"
              : shell === "empty"
                ? "No invites yet"
                : copy.badge
        }
        badgeTone="setup"
        title={copy.title}
        description={error ?? copy.description}
        aria-busy={shell === "loading"}
      >
        {shell === "error" && onRetry ? (
          <Button variant="secondary" type="button" onClick={onRetry}>
            Retry
          </Button>
        ) : null}
        {setup ? (
            <Button as="a" variant="primary" href={setup.href}>
              {setup.label}
            </Button>
          ) : null}
        {shell === "empty" ? (
          <Button as="a" variant="primary" href="#cross-team-scrim-propose">Propose a scrim</Button>
        ) : null}
      </EmptyState>
      {shell === "ready" ? <ScrimNextActionsPanel actions={actions} /> : null}
    </main>
  );
}

export default function CrossTeamScrimClient() {
  const [view, setView] = useState<CrossTeamScrimView | null>(null);
  const [error, setError] = useState("");
  const [fetchFailed, setFetchFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [season, setSeason] = useState<number | null>(null);

  const load = useCallback((seasonOverride?: number) => {
    setFetchFailed(false);
    setError("");
    const params = new URLSearchParams(window.location.search);
    const urlOrg = params.get("orgId");
    const seasonQuery = seasonOverride ?? (params.get("season") ? Number(params.get("season")) : null);
    const query = new URLSearchParams();
    if (urlOrg) query.set("orgId", urlOrg);
    if (seasonQuery) query.set("season", String(seasonQuery));
    void fetch(`/api/cross-team-scrim${query.toString() ? `?${query.toString()}` : ""}`, {
      cache: "no-store",
      signal: AbortSignal.timeout(FEATURE_API_TIMEOUT_MS),
    })
      .then(async (response) => {
        const data = (await response.json()) as CrossTeamScrimView | { error?: string };
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

  const orgId = view && "orgId" in view ? view.orgId : null;
  const inviteCount = view?.status === "live" ? view.invites.length : 0;
  const upcomingCount = view?.status === "live" ? view.upcoming.length : 0;

  const shell = classifyCrossTeamScrimShell({
    loading: view == null && !fetchFailed,
    fetchFailed,
    status: view?.status ?? null,
    orgId: view?.status === "live" ? view.orgId : view?.status === "setup_required" ? view.orgId : null,
    inviteCount,
  });
  const shellCopy = crossTeamScrimShellCopy(shell);
  const nextActions = crossTeamScrimNextActions({
    orgId,
    shell,
    inviteCount,
    upcomingCount,
  });
  const relatedLinks = crossTeamScrimRelatedLinks(orgId, {
    include: [...CROSS_TEAM_SCRIM_RELATED_INCLUDE],
  });
  const teamHref = hubWorkbenchHref("team", "cross-team-scrim", orgId);
  const showTiles = shouldShowCrossTeamScrimSummaryTiles({ inviteCount, upcomingCount });

  const mutate = useCallback(
    async (payload: Record<string, unknown>) => {
      if (!orgId || busy) return;
      setBusy(true);
      setError("");
      try {
        const response = await fetch("/api/cross-team-scrim", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ orgId, seasonYear: season ?? undefined, ...payload }),
          signal: AbortSignal.timeout(FEATURE_API_TIMEOUT_MS),
        });
        const data = (await response.json()) as CrossTeamScrimView | { error?: string };
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

  if (shell === "loading") {
    return <ScrimShell description={shellCopy.description} orgId={null} shell="loading" />;
  }

  if (shell === "error") {
    return (
      <ScrimShell
        description={shellCopy.description}
        orgId={orgId}
        shell="error"
        error={error || shellCopy.description}
        onRetry={() => load()}
      />
    );
  }

  if (shell === "setup") {
    return (
      <ScrimShell
        description={view?.status === "setup_required" ? view.message : shellCopy.description}
        orgId={orgId}
        shell="setup"
      />
    );
  }

  if (view?.status !== "live") {
    return <ScrimShell description={shellCopy.description} orgId={orgId} shell="setup" />;
  }

  return (
    <main className="module-page cross-team-scrim-page">
      <PageHeader
        breadcrumbs={
          <>
            <a href={teamHref}>Team</a>
            {" / Cross-Team Scrims"}
          </>
        }
        title="Cross-Team Scrim Scheduling"
        description="Propose scrimmages with nearby teams and agree on what data — match results, video, or full scouting sheets — will be shared. Cross-check Calendar, Scouting, and Team Data."
      >
        <div className="cross-team-scrim-header-actions">
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
          {relatedLinks.map((link) => (
            <Button as="a" variant="secondary" key={link.id} href={link.href}>
              {link.label}
            </Button>
          ))}
        </div>
      </PageHeader>

      {error ? (
        <p className="telemetry-status" role="alert">
          {error}
        </p>
      ) : null}

      <ScrimNextActionsPanel actions={nextActions} />

      {showTiles ? <SummaryTiles view={view} /> : null}

      {shell === "empty" ? (
        <EmptyState
          soft
          badge="No invites yet"
          badgeTone="setup"
          title={shellCopy.title}
          description={shellCopy.description}
          className="product-hub-setup"
        >
          <Button as="a" variant="primary" href="#cross-team-scrim-propose">
            Propose a scrim
          </Button>
        </EmptyState>
      ) : null}

      <div style={{ display: "grid", gap: 16 }}>
        <CreateInviteForm busy={busy} mutate={mutate} />
        <UpcomingInvites view={view} busy={busy} mutate={mutate} />
        <AllInvites view={view} busy={busy} mutate={mutate} />
      </div>
    </main>
  );
}

function SummaryTiles({ view }: { view: LiveView }) {
  const { summary } = view;
  return (
    <Panel className="cross-team-scrim-panel" aria-label="Scrim invite counts">
      <div className="cross-team-scrim-stats">
        <div>
          <strong>{formatCrossTeamScrimMetric(summary.total, true)}</strong>
          <span className="app-muted">Total invites</span>
        </div>
        <div>
          <strong>{formatCrossTeamScrimMetric(summary.upcomingCount, true)}</strong>
          <span className="app-muted">Upcoming</span>
        </div>
        <div>
          <strong>{formatCrossTeamScrimMetric(summary.agreedDataShareCount, true)}</strong>
          <span className="app-muted">Data-share agreed</span>
        </div>
        {summary.byStatus.length > 0 ? (
          <div>
            <span className="app-muted" style={{ display: "block", marginBottom: 4 }}>
              By status
            </span>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              {summary.byStatus.map((row) => (
                <span key={row.status} className={`app-badge ${statusTone(row.status)}`}>
                  {scrimStatusLabel(row.status)} · {formatCrossTeamScrimMetric(row.count, true)}
                </span>
              ))}
            </div>
          </div>
        ) : null}
      </div>
    </Panel>
  );
}

function UpcomingInvites({
  view,
  busy,
  mutate,
}: {
  view: LiveView;
  busy: boolean;
  mutate: (payload: Record<string, unknown>) => void;
}) {
  if (view.upcoming.length === 0) {
    return (
      <div id="cross-team-scrim-upcoming">
        <EmptyState
          soft
          badge="No upcoming scrims"
          badgeTone="setup"
          title="Propose a scrimmage with a nearby team"
          description="Open invites with a proposed or accepted status will appear here, soonest first."
        />
      </div>
    );
  }
  return (
    <Panel className="cross-team-scrim-panel" id="cross-team-scrim-upcoming">
      <h2 style={{ marginTop: 0 }}>Upcoming</h2>
      <p className="app-muted">Real partner invites only.</p>
      <ul className="cross-team-scrim-list">
        {view.upcoming.map((invite) => (
          <InviteRow key={invite.id} invite={invite} busy={busy} mutate={mutate} />
        ))}
      </ul>
    </Panel>
  );
}

function AllInvites({
  view,
  busy,
  mutate,
}: {
  view: LiveView;
  busy: boolean;
  mutate: (payload: Record<string, unknown>) => void;
}) {
  if (view.invites.length === 0) return null;
  return (
    <Panel className="cross-team-scrim-panel">
      <h2 style={{ marginTop: 0 }}>All invites</h2>
      <ul className="cross-team-scrim-list">
        {view.invites.map((invite) => (
          <InviteRow key={invite.id} invite={invite} busy={busy} mutate={mutate} showDelete />
        ))}
      </ul>
    </Panel>
  );
}

function InviteRow({
  invite,
  busy,
  mutate,
  showDelete,
}: {
  invite: LiveView["invites"][number];
  busy: boolean;
  mutate: (payload: Record<string, unknown>) => void;
  showDelete?: boolean;
}) {
  return (
    <li className="cross-team-scrim-row">
      <div>
        <strong>
          Team {invite.partnerTeamNumber}
          {invite.partnerTeamName ? ` — ${invite.partnerTeamName}` : ""}
        </strong>
        <small className="app-muted" style={{ display: "block" }}>
          {invite.proposedDate ?? "No date proposed"}
          {invite.location ? ` · ${invite.location}` : ""}
          {invite.contactName ? ` · ${invite.contactName}` : ""}
        </small>
        <small className="app-muted">
          Data share: {scrimDataShareLabel(invite.dataShareScope)}
          {invite.dataShareAgreed ? " (agreed)" : " (pending)"}
        </small>
      </div>
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <span className={`app-badge ${statusTone(invite.status)}`}>{scrimStatusLabel(invite.status)}</span>
        <select
          disabled={busy}
          value={invite.status}
          onChange={(event) =>
            mutate({ action: "update-status", inviteId: invite.id, status: event.target.value })
          }
        >
          {SCRIM_STATUSES.map((status) => (
            <option key={status} value={status}>
              {scrimStatusLabel(status)}
            </option>
          ))}
        </select>
        <label style={{ display: "flex", gap: 4, alignItems: "center" }}>
          <input
            type="checkbox"
            disabled={busy}
            checked={invite.dataShareAgreed}
            onChange={(event) =>
              mutate({
                action: "update-data-share",
                inviteId: invite.id,
                dataShareScope: invite.dataShareScope,
                dataShareAgreed: event.target.checked,
              })
            }
          />
          Agreed
        </label>
        {showDelete ? (
          <button
            type="button"
            className="text-button"
            disabled={busy}
            onClick={() => {
              if (window.confirm(`Delete invite to Team ${invite.partnerTeamNumber}?`)) {
                mutate({ action: "delete-invite", inviteId: invite.id });
              }
            }}
          >
            Delete
          </button>
        ) : null}
      </div>
    </li>
  );
}

function CreateInviteForm({
  busy,
  mutate,
}: {
  busy: boolean;
  mutate: (payload: Record<string, unknown>) => void;
}) {
  const empty = useMemo(
    () => ({
      partnerTeamNumber: "",
      partnerTeamName: "",
      contactName: "",
      contactEmail: "",
      proposedDate: "",
      location: "",
      dataShareScope: "none" as ScrimDataShareScope,
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
      id="cross-team-scrim-propose"
      className="cross-team-scrim-panel"
      onSubmit={(event) => {
        event.preventDefault();
        const teamNumber = Number(form.partnerTeamNumber);
        if (!Number.isFinite(teamNumber) || teamNumber <= 0) return;
        mutate({
          action: "create-invite",
          partnerTeamNumber: teamNumber,
          partnerTeamName: form.partnerTeamName || undefined,
          contactName: form.contactName || undefined,
          contactEmail: form.contactEmail || undefined,
          proposedDate: form.proposedDate || undefined,
          location: form.location || undefined,
          dataShareScope: form.dataShareScope,
          notes: form.notes || undefined,
        });
        setForm(empty);
      }}
    >
      <h2 style={{ margin: 0 }}>Propose a scrim</h2>
      <p className="app-muted">Partner rows stay blank until you enter a real team.</p>
      <FormGrid min={160}>
        <FormRow label="Partner team #">
          <input type="number" min={1} value={form.partnerTeamNumber} onChange={set("partnerTeamNumber")} required />
        </FormRow>
        <FormRow label="Partner team name">
          <input value={form.partnerTeamName} onChange={set("partnerTeamName")} />
        </FormRow>
        <FormRow label="Contact name">
          <input value={form.contactName} onChange={set("contactName")} />
        </FormRow>
        <FormRow label="Contact email">
          <input type="email" value={form.contactEmail} onChange={set("contactEmail")} />
        </FormRow>
        <FormRow label="Proposed date">
          <input type="date" value={form.proposedDate} onChange={set("proposedDate")} />
        </FormRow>
        <FormRow label="Location">
          <input value={form.location} onChange={set("location")} />
        </FormRow>
        <FormRow label="Data-share scope">
          <select value={form.dataShareScope} onChange={set("dataShareScope")}>
            {SCRIM_DATA_SHARE_SCOPES.map((scope) => (
              <option key={scope} value={scope}>
                {scrimDataShareLabel(scope)}
              </option>
            ))}
          </select>
        </FormRow>
      </FormGrid>
      <FormRow label="Notes (optional)">
        <textarea value={form.notes} onChange={set("notes")} rows={2} />
      </FormRow>
      <div>
        <Button variant="primary" type="submit" disabled={busy || !form.partnerTeamNumber}>
          Propose scrim
        </Button>
      </div>
    </Panel>
  );
}
