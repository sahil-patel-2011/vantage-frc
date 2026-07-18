"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { EmptyState, FormGrid, FormRow, PageHeader, Panel } from "../../components/ui";
import { PICKLIST_COLLAB_TIERS, picklistCollabTierLabel } from "../../lib/picklist-collab";
import type { PicklistCollabView } from "../../lib/picklist-collab/compute-picklist-collab";
import type { PicklistCollabEntry, PicklistCollabTier } from "../../lib/picklist-collab/types";

type LiveView = Extract<PicklistCollabView, { status: "live" }>;

export default function PicklistCollabClient() {
  const [view, setView] = useState<PicklistCollabView | null>(null);
  const [error, setError] = useState("");
  const [fetchFailed, setFetchFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [listId, setListId] = useState<string | null>(null);

  const orgId = view && "orgId" in view ? view.orgId : null;

  const load = useCallback((listOverride?: string | null) => {
    setFetchFailed(false);
    setError("");
    const params = new URLSearchParams(window.location.search);
    const urlOrg = params.get("orgId");
    const query = new URLSearchParams();
    if (urlOrg) query.set("orgId", urlOrg);
    const targetList = listOverride ?? params.get("listId");
    if (targetList) query.set("listId", targetList);
    void fetch(`/api/picklist-collab${query.toString() ? `?${query.toString()}` : ""}`)
      .then(async (response) => {
        const data = (await response.json()) as PicklistCollabView | { error?: string };
        if (!response.ok || !("status" in data)) {
          setFetchFailed(true);
          return;
        }
        setView(data);
        if (data.status === "live" && data.activeList) setListId(data.activeList.id);
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
        const response = await fetch("/api/picklist-collab", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ orgId, listId: listId ?? undefined, ...payload }),
        });
        const data = (await response.json()) as PicklistCollabView | { error?: string };
        if (!response.ok || !("status" in data)) {
          setError("error" in data && data.error ? data.error : "Something went wrong.");
          return;
        }
        setView(data);
        if (data.status === "live" && data.activeList) setListId(data.activeList.id);
      } catch {
        setError("Network error — please try again.");
      } finally {
        setBusy(false);
      }
    },
    [orgId, listId, busy],
  );

  return (
    <main className="module-page">
      <PageHeader
        breadcrumbs={
          <>
            <a href={orgId ? `/competition?orgId=${encodeURIComponent(orgId)}` : "/competition"}>Competition</a>
            {" / Collaborative Pick List"}
          </>
        }
        title="Collaborative Pick List"
        description="Build the pick list together — rank teams into tiers and cast weighted votes that roll up into a consensus order."
      >
        {view?.status === "live" && view.lists.length > 0 ? (
          <label className="app-muted" style={{ display: "flex", gap: 6, alignItems: "center" }}>
            List
            <select
              value={listId ?? view.activeList?.id ?? ""}
              onChange={(event) => {
                const next = event.target.value;
                setListId(next);
                load(next);
              }}
            >
              {view.lists.map((list) => (
                <option key={list.id} value={list.id}>
                  {list.name}
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
          title="Could not load the pick list"
          description="A network or server issue prevented loading. Try again."
        >
          <button type="button" className="app-button secondary" onClick={() => load()}>
            Retry
          </button>
        </EmptyState>
      ) : view == null ? (
        <EmptyState title="Loading…" description="Checking your workspace." aria-busy />
      ) : view.status === "setup_required" ? (
        <div style={{ display: "grid", gap: 16 }}>
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
          {view.orgId ? <CreateListForm busy={busy} mutate={mutate} /> : null}
        </div>
      ) : (
        <div style={{ display: "grid", gap: 16 }}>
          <SummaryTiles view={view} />
          <AddEntryForm busy={busy} mutate={mutate} />
          <EntriesByTier view={view} busy={busy} mutate={mutate} />
          <CreateListForm busy={busy} mutate={mutate} collapsedLabel="Add another pick list" />
        </div>
      )}
    </main>
  );
}

function SummaryTiles({ view }: { view: LiveView }) {
  const { summary } = view;
  const tiles = [
    { label: "Teams tracked", value: String(summary.totalEntries) },
    { label: "Votes cast", value: String(summary.totalVotes) },
    { label: "Voters", value: String(summary.totalVoters) },
    { label: "List status", value: view.activeList?.status ?? "—" },
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

function EntriesByTier({
  view,
  busy,
  mutate,
}: {
  view: LiveView;
  busy: boolean;
  mutate: (payload: Record<string, unknown>) => void;
}) {
  if (view.summary.totalEntries === 0) {
    return (
      <EmptyState
        badge="No teams yet"
        badgeTone="setup"
        title="Add your first team to this pick list"
        description="Once teams are added, anyone on the team can cast a weighted vote to build consensus."
      />
    );
  }
  return (
    <div style={{ display: "grid", gap: 16 }}>
      {PICKLIST_COLLAB_TIERS.map((tier) => {
        const entries = view.entries.filter((e) => e.tier === tier);
        if (entries.length === 0) return null;
        return (
          <Panel key={tier}>
            <h2 style={{ marginTop: 0 }}>{picklistCollabTierLabel(tier)}</h2>
            <ul style={{ listStyle: "none", padding: 0, display: "grid", gap: 10 }}>
              {entries.map((entry) => (
                <EntryRow key={entry.id} entry={entry} tier={tier} busy={busy} mutate={mutate} />
              ))}
            </ul>
          </Panel>
        );
      })}
    </div>
  );
}

function EntryRow({
  entry,
  tier,
  busy,
  mutate,
}: {
  entry: PicklistCollabEntry;
  tier: PicklistCollabTier;
  busy: boolean;
  mutate: (payload: Record<string, unknown>) => void;
}) {
  const [weight, setWeight] = useState("1");
  const [rank, setRank] = useState("");

  return (
    <li
      style={{
        display: "flex",
        justifyContent: "space-between",
        gap: 12,
        alignItems: "flex-start",
        flexWrap: "wrap",
      }}
    >
      <div>
        <strong>
          #{entry.teamNumber}
          {entry.teamName ? ` — ${entry.teamName}` : ""}
        </strong>
        <small className="app-muted" style={{ display: "block" }}>
          Weighted score {entry.weightedScore} · {entry.votes.length} vote(s)
          {entry.averageRankSuggestion != null ? ` · avg rank ${entry.averageRankSuggestion}` : ""}
        </small>
        {entry.note ? <small className="app-muted">{entry.note}</small> : null}
      </div>
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <select
          value={tier}
          onChange={(event) => mutate({ action: "move-entry", entryId: entry.id, tier: event.target.value, position: entry.position })}
        >
          {PICKLIST_COLLAB_TIERS.map((t) => (
            <option key={t} value={t}>
              {picklistCollabTierLabel(t)}
            </option>
          ))}
        </select>
        <input
          type="number"
          min={0.1}
          max={5}
          step={0.1}
          value={weight}
          onChange={(event) => setWeight(event.target.value)}
          style={{ width: 64 }}
          aria-label="Vote weight"
        />
        <input
          type="number"
          min={1}
          placeholder="Rank"
          value={rank}
          onChange={(event) => setRank(event.target.value)}
          style={{ width: 64 }}
          aria-label="Suggested rank"
        />
        <button
          type="button"
          className="app-button secondary"
          disabled={busy}
          onClick={() =>
            mutate({
              action: "cast-vote",
              entryId: entry.id,
              weight: Number(weight) || 1,
              rankSuggestion: rank ? Number(rank) : undefined,
            })
          }
        >
          Vote
        </button>
        <button
          type="button"
          className="text-button"
          disabled={busy}
          onClick={() => {
            if (window.confirm(`Remove team #${entry.teamNumber} from this list?`)) {
              mutate({ action: "delete-entry", entryId: entry.id });
            }
          }}
        >
          Remove
        </button>
      </div>
    </li>
  );
}

function AddEntryForm({
  busy,
  mutate,
}: {
  busy: boolean;
  mutate: (payload: Record<string, unknown>) => void;
}) {
  const empty = useMemo(
    () => ({ teamNumber: "", teamName: "", tier: "first_pick" as PicklistCollabTier, note: "" }),
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
        if (!form.teamNumber) return;
        mutate({
          action: "add-entry",
          teamNumber: Number(form.teamNumber),
          teamName: form.teamName || undefined,
          tier: form.tier,
          note: form.note || undefined,
        });
        setForm(empty);
      }}
      style={{ display: "grid", gap: 10 }}
    >
      <h2 style={{ margin: 0 }}>Add team</h2>
      <FormGrid min={160}>
        <FormRow label="Team number">
          <input type="number" min={1} value={form.teamNumber} onChange={set("teamNumber")} required />
        </FormRow>
        <FormRow label="Team name (optional)">
          <input value={form.teamName} onChange={set("teamName")} />
        </FormRow>
        <FormRow label="Tier">
          <select value={form.tier} onChange={set("tier")}>
            {PICKLIST_COLLAB_TIERS.map((tier) => (
              <option key={tier} value={tier}>
                {picklistCollabTierLabel(tier)}
              </option>
            ))}
          </select>
        </FormRow>
      </FormGrid>
      <FormRow label="Note (optional)">
        <textarea value={form.note} onChange={set("note")} rows={2} />
      </FormRow>
      <div>
        <button type="submit" className="app-button" disabled={busy || !form.teamNumber}>
          Add to list
        </button>
      </div>
    </Panel>
  );
}

function CreateListForm({
  busy,
  mutate,
  collapsedLabel,
}: {
  busy: boolean;
  mutate: (payload: Record<string, unknown>) => void;
  collapsedLabel?: string;
}) {
  const empty = useMemo(() => ({ name: "", eventKey: "" }), []);
  const [form, setForm] = useState(empty);
  const [open, setOpen] = useState(!collapsedLabel);
  const set = (key: keyof typeof form) => (event: { target: { value: string } }) =>
    setForm((prev) => ({ ...prev, [key]: event.target.value }));

  if (!open) {
    return (
      <button type="button" className="app-button secondary" onClick={() => setOpen(true)}>
        {collapsedLabel}
      </button>
    );
  }

  return (
    <Panel
      as="form"
      onSubmit={(event) => {
        event.preventDefault();
        if (!form.name.trim() || !form.eventKey.trim()) return;
        mutate({ action: "create-list", name: form.name, eventKey: form.eventKey });
        setForm(empty);
        setOpen(!collapsedLabel);
      }}
      style={{ display: "grid", gap: 10 }}
    >
      <h2 style={{ margin: 0 }}>Create pick list</h2>
      <FormGrid min={160}>
        <FormRow label="List name">
          <input value={form.name} onChange={set("name")} placeholder="Week 3 Regional" required />
        </FormRow>
        <FormRow label="Event key">
          <input value={form.eventKey} onChange={set("eventKey")} placeholder="2026miket" required />
        </FormRow>
      </FormGrid>
      <div>
        <button type="submit" className="app-button" disabled={busy || !form.name.trim() || !form.eventKey.trim()}>
          Create list
        </button>
      </div>
    </Panel>
  );
}
