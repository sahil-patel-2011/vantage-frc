"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { EmptyState, FormGrid, FormRow, PageHeader, Panel } from "../../components/ui";
import type { ScoutDataImpactView } from "../../lib/scout-data-impact/compute-scout-data-impact";

function pct(value: number): string {
  return `${Math.round(value * 100)}%`;
}

type LiveView = Extract<ScoutDataImpactView, { status: "live" }>;

export default function ScoutDataImpactClient() {
  const [view, setView] = useState<ScoutDataImpactView | null>(null);
  const [error, setError] = useState("");
  const [fetchFailed, setFetchFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [eventKey, setEventKey] = useState<string | null>(null);

  const orgId = view && "orgId" in view ? view.orgId : null;

  const load = useCallback((eventOverride?: string) => {
    setFetchFailed(false);
    setError("");
    const params = new URLSearchParams(window.location.search);
    const urlOrg = params.get("orgId");
    const eventQuery = eventOverride ?? params.get("eventKey");
    const query = new URLSearchParams();
    if (urlOrg) query.set("orgId", urlOrg);
    if (eventQuery) query.set("eventKey", eventQuery);
    void fetch(`/api/scout-data-impact${query.toString() ? `?${query.toString()}` : ""}`)
      .then(async (response) => {
        const data = (await response.json()) as ScoutDataImpactView | { error?: string };
        if (!response.ok || !("status" in data)) {
          setFetchFailed(true);
          return;
        }
        setView(data);
        if ("eventKey" in data) setEventKey(data.eventKey);
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
        const response = await fetch("/api/scout-data-impact", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ orgId, eventKey: eventKey ?? undefined, ...payload }),
        });
        const data = (await response.json()) as ScoutDataImpactView | { error?: string };
        if (!response.ok || !("status" in data)) {
          setError("error" in data && data.error ? data.error : "Something went wrong.");
          return;
        }
        setView(data);
        if ("eventKey" in data) setEventKey(data.eventKey);
      } catch {
        setError("Network error — please try again.");
      } finally {
        setBusy(false);
      }
    },
    [orgId, eventKey, busy],
  );

  return (
    <main className="module-page">
      <PageHeader
        breadcrumbs={
          <>
            <a href={orgId ? `/competition?orgId=${encodeURIComponent(orgId)}` : "/competition"}>Competition</a>
            {" / Scout Data Impact"}
          </>
        }
        title="Scout Data Impact"
        description="After alliance selection, see which of your scouting entries informed each pick — the where-your-data-went feedback loop."
      >
        <div style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center" }}>
          {view?.status === "live" && view.events.length > 0 ? (
            <label className="app-muted" style={{ display: "flex", gap: 6, alignItems: "center" }}>
              Event
              <select
                value={eventKey ?? view.eventKey}
                onChange={(event) => {
                  const next = event.target.value;
                  setEventKey(next);
                  load(next);
                }}
              >
                {view.events.map((e) => (
                  <option key={e.eventKey} value={e.eventKey}>
                    {e.name ?? e.eventKey}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
        </div>
      </PageHeader>

      {error ? (
        <p className="telemetry-status" role="alert">
          {error}
        </p>
      ) : null}

      {fetchFailed ? (
        <EmptyState
          title="Could not load Scout Data Impact"
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
          {view.orgId ? <LogPickForm busy={busy} mutate={mutate} /> : null}
        </EmptyState>
      ) : (
        <div style={{ display: "grid", gap: 16 }}>
          <SummaryTiles view={view} />
          <LogPickForm busy={busy} mutate={mutate} />
          <ScoutSummaries view={view} />
          <PicksList view={view} busy={busy} mutate={mutate} />
        </div>
      )}
    </main>
  );
}

function SummaryTiles({ view }: { view: LiveView }) {
  const tiles = [
    { label: "Picks logged", value: String(view.picks.length) },
    { label: "Entries that informed picks", value: String(view.totalEntries) },
    { label: "Pick coverage", value: pct(view.coverageRatio) },
    { label: "Scouts credited", value: String(view.scoutSummaries.length) },
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
      </div>
    </Panel>
  );
}

function ScoutSummaries({ view }: { view: LiveView }) {
  if (view.scoutSummaries.length === 0) {
    return (
      <EmptyState
        badge="No attributable entries yet"
        badgeTone="setup"
        title="No scouting entries match the logged picks"
        description="Once match scouting entries exist for a picked team, this list will show who contributed."
      />
    );
  }
  return (
    <Panel>
      <h2 style={{ marginTop: 0 }}>Your data, credited</h2>
      <ul style={{ listStyle: "none", padding: 0, display: "grid", gap: 10 }}>
        {view.scoutSummaries.map((scout) => (
          <li key={scout.scoutUserId} style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
            <div>
              <strong>{scout.scoutName}</strong>
              <small className="app-muted" style={{ display: "block" }}>
                {scout.teamsScoutedThatWerePicked.length} picked team(s) informed
              </small>
            </div>
            <small className="app-muted">
              {scout.totalEntries} entries · {scout.picksInformed} pick(s)
            </small>
          </li>
        ))}
      </ul>
    </Panel>
  );
}

function PicksList({
  view,
  busy,
  mutate,
}: {
  view: LiveView;
  busy: boolean;
  mutate: (payload: Record<string, unknown>) => void;
}) {
  if (view.picks.length === 0) {
    return (
      <EmptyState
        badge="No picks yet"
        badgeTone="setup"
        title="Log your first alliance pick"
        description="Once picks are logged, matching scouting entries will surface here automatically."
      />
    );
  }
  return (
    <Panel>
      <h2 style={{ marginTop: 0 }}>Picks and their evidence</h2>
      <ul style={{ listStyle: "none", padding: 0, display: "grid", gap: 12 }}>
        {view.picks.map((item) => (
          <li key={item.pick.id} className="app-card soft-panel" style={{ padding: 12 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8 }}>
              <div>
                <strong>
                  Alliance {item.pick.allianceNumber} · Pick {item.pick.pickOrder} — Team{" "}
                  {item.pick.teamNumber ?? item.pick.teamKey}
                </strong>
                <small className="app-muted" style={{ display: "block" }}>
                  {item.totalEntries} scouting entr{item.totalEntries === 1 ? "y" : "ies"} informed this pick
                  {item.pick.notes ? ` · ${item.pick.notes}` : ""}
                </small>
              </div>
              <button
                type="button"
                className="text-button"
                disabled={busy}
                onClick={() => {
                  if (window.confirm(`Remove pick for Team ${item.pick.teamNumber ?? item.pick.teamKey}?`)) {
                    mutate({ action: "delete-pick", pickId: item.pick.id });
                  }
                }}
              >
                Delete
              </button>
            </div>
            {item.contributions.length > 0 ? (
              <ul style={{ listStyle: "none", padding: 0, marginTop: 8, display: "grid", gap: 4 }}>
                {item.contributions.map((c) => (
                  <li key={c.scoutUserId} style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                    <span>{c.scoutName}</span>
                    <small className="app-muted">
                      {c.entryCount} entr{c.entryCount === 1 ? "y" : "ies"} · {c.matchKeys.length} match(es)
                    </small>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="app-muted" style={{ marginTop: 8 }}>
                No scouting entries were found for this team at this event.
              </p>
            )}
          </li>
        ))}
      </ul>
    </Panel>
  );
}

function LogPickForm({
  busy,
  mutate,
}: {
  busy: boolean;
  mutate: (payload: Record<string, unknown>) => void;
}) {
  const empty = useMemo(
    () => ({
      eventKey: "",
      teamKey: "",
      allianceNumber: "1",
      pickOrder: "1",
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
        if (!form.eventKey.trim() || !form.teamKey.trim()) return;
        mutate({
          action: "log-pick",
          eventKey: form.eventKey.trim(),
          teamKey: form.teamKey.trim(),
          allianceNumber: Number(form.allianceNumber) || 1,
          pickOrder: Number(form.pickOrder) || 1,
          notes: form.notes || undefined,
        });
        setForm(empty);
      }}
      style={{ display: "grid", gap: 10 }}
    >
      <h2 style={{ margin: 0 }}>Log alliance pick</h2>
      <FormGrid min={160}>
        <FormRow label="Event key">
          <input value={form.eventKey} onChange={set("eventKey")} placeholder="2026txho" required />
        </FormRow>
        <FormRow label="Team key">
          <input value={form.teamKey} onChange={set("teamKey")} placeholder="frc254" required />
        </FormRow>
        <FormRow label="Alliance #">
          <input type="number" min={1} max={8} value={form.allianceNumber} onChange={set("allianceNumber")} />
        </FormRow>
        <FormRow label="Pick order">
          <input type="number" min={1} value={form.pickOrder} onChange={set("pickOrder")} />
        </FormRow>
      </FormGrid>
      <FormRow label="Notes (optional)">
        <textarea value={form.notes} onChange={set("notes")} rows={2} />
      </FormRow>
      <div>
        <button
          type="submit"
          className="app-button"
          disabled={busy || !form.eventKey.trim() || !form.teamKey.trim()}
        >
          Log pick
        </button>
      </div>
    </Panel>
  );
}
