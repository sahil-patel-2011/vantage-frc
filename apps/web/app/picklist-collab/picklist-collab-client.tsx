"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { OfflineBanner } from "../../components/offline-banner";
import {
  Badge,
  Button,
  EmptyState,
  ErrorState,
  FormGrid,
  FormRow,
  PageHeader,
  Panel,
  SoftBlockSkeleton,
  StatTile,
} from "../../components/ui";
import { PICKLIST_COLLAB_TIERS, epaRoleLabel, picklistCollabTierLabel, picklistToCsv } from "../../lib/picklist-collab";
import type { PicklistCollabView } from "../../lib/picklist-collab/compute-picklist-collab";
import {
  PICKLIST_COLLAB_RELATED_INCLUDE,
  classifyPicklistCollabShell,
  formatPicklistCollabMetric,
  picklistCollabNextActions,
  picklistCollabRelatedLinks,
  picklistCollabSetupSteps,
  picklistCollabShellCopy,
  shouldShowPicklistCollabSummaryTiles,
  type PicklistCollabNextAction,
  type PicklistCollabShellKind,
} from "../../lib/picklist-collab/picklist-collab-related";
import type { PicklistCollabEntry, PicklistCollabTier } from "../../lib/picklist-collab/types";
import { hubWorkbenchHref } from "../../lib/nav/hubs";
import { FEATURE_API_TIMEOUT_MS } from "../../lib/nav/resolve-org";
import { getFeatureSnapshot, putFeatureSnapshot } from "../../lib/offline/feature-cache";
import "./picklist-collab.css";

function isPicklistCollabView(value: unknown): value is PicklistCollabView {
  if (!value || typeof value !== "object") return false;
  const status = (value as { status?: unknown }).status;
  return status === "setup_required" || status === "live";
}

async function persistPicklistCollabSnapshot(
  orgHint: string,
  listHint: string,
  data: PicklistCollabView,
): Promise<void> {
  const cacheOrg =
    "orgId" in data && typeof data.orgId === "string" && data.orgId.trim()
      ? data.orgId
      : orgHint;
  if (!cacheOrg) return;
  try {
    await putFeatureSnapshot("picklist-collab", cacheOrg, data, listHint);
    if (!orgHint) await putFeatureSnapshot("picklist-collab", "_", data, listHint);
  } catch {
    // Live pick list already painted; IndexedDB is best-effort.
  }
}

type LiveView = Extract<PicklistCollabView, { status: "live" }>;

function RelatedStrip({ orgId }: { orgId?: string | null }) {
  const links = picklistCollabRelatedLinks(orgId, {
    include: [...PICKLIST_COLLAB_RELATED_INCLUDE],
  });
  if (!links.length) return null;
  return (
    <nav className="product-hub-related picklist-collab-related" aria-label="Related competition tools">
      {links.map((link) => (
        <Button as="a" variant="secondary" key={link.id} href={link.href}>
          {link.label}
        </Button>
      ))}
    </nav>
  );
}

function NextActionsPanel({ actions }: { actions: PicklistCollabNextAction[] }) {
  if (!actions.length) return null;
  return (
    <section
      className="app-card soft-panel edc-next-actions picklist-collab-next-actions"
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

function CollabShell({
  description,
  orgId,
  shell,
  error,
  onRetry,
  children,
}: {
  description: string;
  orgId?: string | null;
  shell: PicklistCollabShellKind;
  error?: string;
  onRetry?: () => void;
  children?: ReactNode;
}) {
  const actions = picklistCollabNextActions({ orgId, shell });
  const copy = picklistCollabShellCopy(shell);
  const competitionHref = hubWorkbenchHref("competition", "picklist-collab", orgId);
  const setup = shell === "setup" ? picklistCollabSetupSteps(orgId)[0] : null;

  return (
    <main className="module-page picklist-collab-page soft-gate">
      <PageHeader
        breadcrumbs={
          <>
            <a href={competitionHref}>Competition</a>
            {" / Collaborative pick list"}
          </>
        }
        title="Collaborative pick list"
        description={description}
      >
        <RelatedStrip orgId={orgId} />
      </PageHeader>
      {children}
      {shell === "loading" ? (
        <div aria-busy="true" aria-label="Loading pick list">
          <SoftBlockSkeleton lines={4} />
        </div>
      ) : shell === "error" ? (
        <ErrorState message={error ?? copy.description} onRetry={onRetry} />
      ) : (
        <EmptyState
          soft
          badge={shell === "setup" ? "Needs setup" : copy.badge}
          badgeTone="setup"
          title={copy.title}
          description={error ?? copy.description}
        >
          {setup ? (
            <Button as="a" variant="primary" href={setup.href}>
              {setup.label}
            </Button>
          ) : null}
          {shell === "empty" ? (
            <Button as="a" variant="primary" href="#picklist-collab-create">
              Create pick list
            </Button>
          ) : null}
        </EmptyState>
      )}
      {shell === "ready" ? <NextActionsPanel actions={actions} /> : null}
    </main>
  );
}

export default function PicklistCollabClient() {
  const [view, setView] = useState<PicklistCollabView | null>(null);
  const [error, setError] = useState("");
  const [fetchFailed, setFetchFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [listId, setListId] = useState<string | null>(null);
  const [fromCache, setFromCache] = useState(false);
  const [cachedAt, setCachedAt] = useState<string | null>(null);
  const viewRef = useRef<PicklistCollabView | null>(null);
  viewRef.current = view;

  const load = useCallback((listOverride?: string | null) => {
    void (async () => {
      const params = new URLSearchParams(window.location.search);
      const urlOrg = params.get("orgId")?.trim() ?? "";
      const targetList = (listOverride ?? params.get("listId") ?? "").trim();
      let hadCache = Boolean(viewRef.current);
      try {
        const cached = await getFeatureSnapshot<PicklistCollabView>(
          "picklist-collab",
          urlOrg || "_",
          targetList,
        );
        if (!viewRef.current && cached?.data && isPicklistCollabView(cached.data)) {
          setView(cached.data);
          if (cached.data.status === "live" && cached.data.activeList) {
            setListId(cached.data.activeList.id);
          }
          setFromCache(true);
          setCachedAt(cached.cachedAt);
          hadCache = true;
        }
      } catch {
        // IndexedDB missing or blocked; live fetch still runs.
      }
      setFetchFailed(false);
      setError("");
      const query = new URLSearchParams();
      if (urlOrg) query.set("orgId", urlOrg);
      if (targetList) query.set("listId", targetList);
      try {
        const response = await fetch(
          `/api/picklist-collab${query.toString() ? `?${query.toString()}` : ""}`,
          {
            cache: "no-store",
            signal: AbortSignal.timeout(FEATURE_API_TIMEOUT_MS),
          },
        );
        const data = (await response.json()) as PicklistCollabView | { error?: string };
        if (!response.ok || !isPicklistCollabView(data)) {
          if (hadCache || viewRef.current) {
            setFromCache(true);
            setError("Could not refresh the pick list. Showing the last copy on this device.");
            setFetchFailed(false);
          } else {
            setFetchFailed(true);
          }
          return;
        }
        setView(data);
        if (data.status === "live" && data.activeList) setListId(data.activeList.id);
        setFromCache(false);
        setCachedAt(null);
        await persistPicklistCollabSnapshot(urlOrg, targetList, data);
      } catch {
        if (hadCache || viewRef.current) {
          setFromCache(true);
          setError("Could not refresh the pick list. Showing the last copy on this device.");
          setFetchFailed(false);
        } else {
          setFetchFailed(true);
        }
      }
    })();
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const orgId = view && "orgId" in view ? view.orgId : null;
  const listCount = view?.status === "live" ? view.lists.length : 0;
  const totalEntries = view?.status === "live" ? view.summary.totalEntries : 0;
  const totalVotes = view?.status === "live" ? view.summary.totalVotes : 0;

  const shell = classifyPicklistCollabShell({
    loading: view == null && !fetchFailed,
    fetchFailed,
    status: view?.status ?? null,
    orgId,
    listCount,
  });
  const shellCopy = picklistCollabShellCopy(shell);
  const nextActions = picklistCollabNextActions({
    orgId,
    shell,
    listCount,
    totalEntries,
    totalVotes,
  });
  const relatedLinks = picklistCollabRelatedLinks(orgId, {
    include: [...PICKLIST_COLLAB_RELATED_INCLUDE],
  });
  const competitionHref = hubWorkbenchHref("competition", "picklist-collab", orgId);
  const showTiles = shouldShowPicklistCollabSummaryTiles({ listCount, totalEntries });

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
          signal: AbortSignal.timeout(FEATURE_API_TIMEOUT_MS),
        });
        const data = (await response.json()) as PicklistCollabView | { error?: string };
        if (!response.ok || !("status" in data)) {
          setError("error" in data && data.error ? data.error : "Something went wrong.");
          return;
        }
        setView(data);
        if (data.status === "live" && data.activeList) setListId(data.activeList.id);
        void persistPicklistCollabSnapshot(orgId, listId ?? "", data);
      } catch {
        setError("Network error — please try again.");
      } finally {
        setBusy(false);
      }
    },
    [orgId, listId, busy],
  );

  if (shell === "loading") {
    return (
      <CollabShell description={shellCopy.description} orgId={null} shell="loading">
        <OfflineBanner feature="Collaborative pick list" fromCache={fromCache} cachedAt={cachedAt} />
      </CollabShell>
    );
  }

  if (shell === "error") {
    return (
      <CollabShell
        description={shellCopy.description}
        orgId={orgId}
        shell="error"
        error={error || shellCopy.description}
        onRetry={() => load()}
      >
        <OfflineBanner feature="Collaborative pick list" fromCache={fromCache} cachedAt={cachedAt} />
      </CollabShell>
    );
  }

  if (shell === "setup") {
    return (
      <CollabShell
        description={view?.status === "setup_required" ? view.message : shellCopy.description}
        orgId={orgId}
        shell="setup"
      >
        <OfflineBanner feature="Collaborative pick list" fromCache={fromCache} cachedAt={cachedAt} />
      </CollabShell>
    );
  }

  return (
    <main className="module-page picklist-collab-page">
      <PageHeader
        breadcrumbs={
          <>
            <a href={competitionHref}>Competition</a>
            {" / Collaborative pick list"}
          </>
        }
        title="Collaborative pick list"
        description="Build the pick list together — rank teams into tiers, see FAST-style EPA roles from the cached event field, and export CSV for the drive team."
      >
        <div className="picklist-collab-header-actions">
          {view?.status === "live" && view.lists.length > 0 ? (
            <label className="app-muted picklist-collab-select">
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
          {view?.status === "live" && view.activeList && view.entries.length > 0 ? (
            <Button variant="secondary" type="button" onClick={() => { const csv = picklistToCsv({ listName: view.activeList!.name, entries: view.entries }); const blob = new Blob([csv], { type: "text/csv;charset=utf-8" }); const url = URL.createObjectURL(blob); const link = document.createElement("a"); link.href = url; link.download = `${view.activeList!.name.replace(/[^\w.-]+/g, "-").replace(/^-|-$/g, "") || "picklist"}.csv`; link.click(); URL.revokeObjectURL(url); }}>
              Download CSV
            </Button>
          ) : null}
          {relatedLinks.map((link) => (
            <Button as="a" variant="secondary" key={link.id} href={link.href}>
              {link.label}
            </Button>
          ))}
        </div>
      </PageHeader>

      <OfflineBanner feature="Collaborative pick list" fromCache={fromCache} cachedAt={cachedAt} />

      {error ? (
        <p className="telemetry-status" role="alert">
          {error}
        </p>
      ) : null}

      {shell === "ready" ? <NextActionsPanel actions={nextActions} /> : null}

      {showTiles && view?.status === "live" ? (
        <section className="picklist-collab-stats" aria-label="Pick list counts">
          <StatTile
            label="Teams tracked"
            value={formatPicklistCollabMetric(view.summary.totalEntries, true)}
          />
          <StatTile
            label="Votes cast"
            value={formatPicklistCollabMetric(view.summary.totalVotes, true)}
          />
          <StatTile
            label="Voters"
            value={formatPicklistCollabMetric(view.summary.totalVoters, true)}
          />
        </section>
      ) : null}

      {shell === "empty" ? (
        <div className="picklist-collab-layout">
          <EmptyState
            soft
            badge="No lists yet"
            badgeTone="setup"
            title={shellCopy.title}
            description={shellCopy.description}
          />
          <CreateListForm busy={busy} mutate={mutate} />
        </div>
      ) : view?.status === "live" ? (
        <div className="picklist-collab-layout">
          <SummaryStatus view={view} />
          <AddEntryForm busy={busy} mutate={mutate} />
          <EntriesByTier view={view} busy={busy} mutate={mutate} />
          <CreateListForm busy={busy} mutate={mutate} collapsedLabel="Add another pick list" />
        </div>
      ) : null}
    </main>
  );
}

function SummaryStatus({ view }: { view: LiveView }) {
  return (
    <Panel className="picklist-collab-panel">
      <div className="picklist-collab-status-row">
        <span className="app-muted">List status</span>
        <Badge
          tone={
            view.activeList?.status === "locked"
              ? "setup"
              : view.activeList?.status === "archived"
                ? "neutral"
                : "good"
          }
        >
          {view.activeList?.status ?? "—"}
        </Badge>
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
        soft
        badge="No teams yet"
        badgeTone="setup"
        title="Add your first team to this pick list"
        description="Once teams are added, anyone on the team can cast a weighted vote to build consensus."
      />
    );
  }
  return (
    <div id="picklist-collab-entries" className="picklist-collab-layout">
      {PICKLIST_COLLAB_TIERS.map((tier) => {
        const entries = view.entries.filter((e) => e.tier === tier);
        if (entries.length === 0) return null;
        return (
          <Panel key={tier} className="picklist-collab-panel">
            <h2 style={{ marginTop: 0 }}>{picklistCollabTierLabel(tier)}</h2>
            <ul className="picklist-collab-list">
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
    <li className="picklist-collab-entry">
      <div>
        <strong>
          #{entry.teamNumber}
          {entry.teamName ? ` — ${entry.teamName}` : ""}
        </strong>
        <small className="app-muted picklist-collab-tip">
          Weighted score {entry.weightedScore} · {entry.votes.length} vote(s)
          {entry.averageRankSuggestion != null ? ` · avg rank ${entry.averageRankSuggestion}` : ""}
          {entry.epaRole ? ` · ${epaRoleLabel(entry.epaRole)}` : ""}
        </small>
        {entry.note ? <small className="app-muted">{entry.note}</small> : null}
      </div>
      <div className="picklist-collab-entry-actions">
        <select
          value={tier}
          aria-label={`Tier for team #${entry.teamNumber}`}
          onChange={(event) =>
            mutate({
              action: "move-entry",
              entryId: entry.id,
              tier: event.target.value,
              position: entry.position,
            })
          }
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
          className="picklist-collab-num"
          aria-label="Vote weight"
        />
        <input
          type="number"
          min={1}
          placeholder="Rank"
          value={rank}
          onChange={(event) => setRank(event.target.value)}
          className="picklist-collab-num"
          aria-label="Suggested rank"
        />
        <Button
          variant="secondary"
          size="sm"
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
        </Button>
        <Button
          variant="ghost"
          size="sm"
          disabled={busy}
          onClick={() => {
            if (window.confirm(`Remove team #${entry.teamNumber} from this list?`)) {
              mutate({ action: "delete-entry", entryId: entry.id });
            }
          }}
        >
          Remove
        </Button>
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
      id="picklist-collab-add"
      as="form"
      className="picklist-collab-panel"
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
        <Button as="button" type="submit" variant="primary" disabled={busy || !form.teamNumber}>
          Add to list
        </Button>
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
      <Button variant="secondary" onClick={() => setOpen(true)}>
        {collapsedLabel}
      </Button>
    );
  }

  return (
    <Panel
      id="picklist-collab-create"
      as="form"
      className="picklist-collab-panel"
      onSubmit={(event) => {
        event.preventDefault();
        if (!form.name.trim() || !form.eventKey.trim()) return;
        mutate({ action: "create-list", name: form.name, eventKey: form.eventKey });
        setForm(empty);
        setOpen(!collapsedLabel);
      }}
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
        <Button
          as="button"
          type="submit"
          variant="primary"
          disabled={busy || !form.name.trim() || !form.eventKey.trim()}
        >
          Create list
        </Button>
      </div>
    </Panel>
  );
}
