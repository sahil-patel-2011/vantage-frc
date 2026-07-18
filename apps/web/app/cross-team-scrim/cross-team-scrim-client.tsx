"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { EmptyState, FormGrid, FormRow, PageHeader, Panel } from "../../components/ui";
import { scrimDataShareLabel, scrimStatusLabel } from "../../lib/cross-team-scrim";
import {
  SCRIM_DATA_SHARE_SCOPES,
  SCRIM_STATUSES,
  type CrossTeamScrimView,
} from "../../lib/cross-team-scrim/compute-cross-team-scrim";
import type { ScrimDataShareScope, ScrimStatus } from "../../lib/cross-team-scrim/types";

function statusTone(status: ScrimStatus): string {
  if (status === "completed" || status === "accepted" || status === "scheduled") return "good";
  if (status === "proposed") return "setup";
  return "demo";
}

type LiveView = Extract<CrossTeamScrimView, { status: "live" }>;

export default function CrossTeamScrimClient() {
  const [view, setView] = useState<CrossTeamScrimView | null>(null);
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
    void fetch(`/api/cross-team-scrim${query.toString() ? `?${query.toString()}` : ""}`)
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

  return (
    <main className="module-page">
      <PageHeader
        breadcrumbs={
          <>
            <a href={orgId ? `/team?orgId=${encodeURIComponent(orgId)}` : "/team"}>Team</a>
            {" / Cross-Team Scrims"}
          </>
        }
        title="Cross-Team Scrim Scheduling"
        description="Propose scrimmages with nearby teams and agree on what data — match results, video, or full scouting sheets — will be shared."
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
        <EmptyState
          title="Could not load scrim scheduling"
          description="A network or server issue prevented loading. Try again."
        >
          <button type="button" className="app-button secondary" onClick={() => load()}>
            Retry
          </button>
        </EmptyState>
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
                <a href={step.href}>Open</a>
              </li>
            ))}
          </ol>
        </EmptyState>
      ) : (
        <div style={{ display: "grid", gap: 16 }}>
          <SummaryTiles view={view} />
          <CreateInviteForm busy={busy} mutate={mutate} />
          <UpcomingInvites view={view} busy={busy} mutate={mutate} />
          <AllInvites view={view} busy={busy} mutate={mutate} />
        </div>
      )}
    </main>
  );
}

function SummaryTiles({ view }: { view: LiveView }) {
  const { summary } = view;
  const tiles = [
    { label: "Total invites", value: String(summary.total) },
    { label: "Upcoming", value: String(summary.upcomingCount) },
    { label: "Data-share agreed", value: String(summary.agreedDataShareCount) },
  ];
  return (
    <Panel>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 12 }}>
        {tiles.map((tile) => (
          <div key={tile.label}>
            <strong style={{ fontSize: "1.6rem", display: "block" }}>{tile.value}</strong>
            <span className="app-muted">{tile.label}</span>
          </div>
        ))}
        {summary.byStatus.length > 0 ? (
          <div>
            <span className="app-muted" style={{ display: "block", marginBottom: 4 }}>
              By status
            </span>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              {summary.byStatus.map((row) => (
                <span key={row.status} className={`app-badge ${statusTone(row.status)}`}>
                  {scrimStatusLabel(row.status)} · {row.count}
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
      <EmptyState
        badge="No upcoming scrims"
        badgeTone="setup"
        title="Propose a scrimmage with a nearby team"
        description="Open invites with a proposed or accepted status will appear here, soonest first."
      />
    );
  }
  return (
    <Panel>
      <h2 style={{ marginTop: 0 }}>Upcoming</h2>
      <ul style={{ listStyle: "none", padding: 0, display: "grid", gap: 10 }}>
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
    <Panel>
      <h2 style={{ marginTop: 0 }}>All invites</h2>
      <ul style={{ listStyle: "none", padding: 0, display: "grid", gap: 10 }}>
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
    <li style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "flex-start", flexWrap: "wrap" }}>
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
      style={{ display: "grid", gap: 10 }}
    >
      <h2 style={{ margin: 0 }}>Propose a scrim</h2>
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
        <button type="submit" className="app-button" disabled={busy || !form.partnerTeamNumber}>
          Propose scrim
        </button>
      </div>
    </Panel>
  );
}
