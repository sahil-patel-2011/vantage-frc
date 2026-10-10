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
  Modal,
  ConfirmProvider,
  useConfirm,
} from "../../components/ui";
import { rankByWeightedZScores, type MetricWeight } from "@vantage/prediction-strategy";
import { usePathname } from "next/navigation";
import {
  PICKLIST_COLLAB_TIERS,
  picklistCollabTierLabel,
  picklistToCsv,
  sortEntriesWithFieldRating,
  type PicklistOrderMode,
} from "../../lib/picklist-collab";
import { PicklistWeightSliders, usePicklistFieldWeights } from "./picklist-weight-sliders";
import { PicklistEventRanking } from "./picklist-event-ranking";
import { PicklistTierList } from "./picklist-tier-list";
import { orderPayload, type TierGroup } from "../../lib/picklist-collab/reorder";
import type { PicklistCollabView } from "../../lib/picklist-collab/compute-picklist-collab";
import {
  PICKLIST_COLLAB_RELATED_INCLUDE,
  classifyPicklistCollabShell,
  formatPicklistCollabMetric,
  picklistCollabRelatedLinks,
  picklistCollabSetupSteps,
  picklistCollabShellCopy,
  shouldShowPicklistCollabSummaryTiles,
  type PicklistCollabShellKind,
} from "../../lib/picklist-collab/picklist-collab-related";
import type { PicklistCollabTier } from "../../lib/picklist-collab/types";
import type { CollabMutate } from "../../lib/picklist-collab/view-contract";
import { useCollabData } from "./use-collab-data";
import { useDiscussionDraft, type ReportDiscussionDraft } from "./use-discussion-draft";
import { useFollowUrl } from "../../lib/nav/use-follow-url";
import { hubWorkbenchHref } from "../../lib/nav/hubs";
import { scoutEventLabel } from "../../lib/scouting/scouting-related";
import "./picklist-collab.css";

function PicklistHeader({ embedded, title, description, breadcrumbs, children }: {
  embedded?: boolean; title: ReactNode; description?: ReactNode; breadcrumbs?: ReactNode; children?: ReactNode;
}) {
  if (!embedded) return <PageHeader title={title} description={description} breadcrumbs={breadcrumbs}>{children}</PageHeader>;
  return <header className="picklist-inline-header"><div><h2>Team discussion</h2>{description ? <p>{description}</p> : null}</div>{children ? <div className="picklist-inline-actions">{children}</div> : null}</header>;
}

type LiveView = Extract<PicklistCollabView, { status: "live" }>;

/**
 * The Scouting app (/scout/picklist) shows this same page inside its own
 * five-tab frame. Links out to Vantage's Competition tools would leave it.
 */
function useInScoutApp(): boolean {
  return (usePathname() ?? "").startsWith("/scout");
}

function Crumbs({ href }: { href: string }) {
  if (useInScoutApp()) return null;
  return (
    <>
      <a href={href}>Competition</a>
      {" / Collaborative pick list"}
    </>
  );
}

function RelatedStrip({ orgId }: { orgId?: string | null }) {
  const inScoutApp = useInScoutApp();
  const links = inScoutApp
    ? []
    : picklistCollabRelatedLinks(orgId, {
        include: [...PICKLIST_COLLAB_RELATED_INCLUDE],
      });
  if (!links.length) return null;
  return (
    <nav className="product-hub-related picklist-collab-related" aria-label="Related competition tools">
      {links.map((link) => (
        <a key={link.id} href={link.href}>{link.label}</a>
      ))}
    </nav>
  );
}

function CollabShell({
  embedded,
  description,
  orgId,
  shell,
  error,
  onRetry,
  emptyTitle,
  emptyDescription,
  action,
  suppressSetupAction = false,
  children,
}: {
  embedded?: boolean;
  description: string;
  orgId?: string | null;
  shell: PicklistCollabShellKind;
  error?: string;
  onRetry?: () => void;
  emptyTitle?: string;
  emptyDescription?: string;
  action?: { href: string; label: string } | null;
  suppressSetupAction?: boolean;
  children?: ReactNode;
}) {
  const copy = picklistCollabShellCopy(shell);
  const competitionHref = hubWorkbenchHref("competition", "picklist-collab", orgId);
  const setup = shell === "setup" && !suppressSetupAction ? picklistCollabSetupSteps(orgId)[0] : null;
  const Root = embedded ? "section" : "main";

  return (
    <Root className="module-page picklist-collab-page soft-gate">
      <PicklistHeader embedded={embedded}
        breadcrumbs={<Crumbs href={competitionHref} />}
        title="Collaborative pick list"
        description={description}
      >
        {embedded ? null : <RelatedStrip orgId={orgId} />}
      </PicklistHeader>
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
          badge={copy.badge}
          badgeTone="setup"
          title={emptyTitle ?? copy.title}
          description={emptyDescription ?? error ?? copy.description}
        >
          {action ? (
            <Button as="a" variant="primary" href={action.href}>
              {action.label}
            </Button>
          ) : setup ? (
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
    </Root>
  );
}

export default function PicklistCollabClient({ embedded = false, orgId, onBusyChange, onDirtyChange }: { embedded?: boolean; orgId?: string | null; onBusyChange?: (busy: boolean) => void; onDirtyChange?: (dirty: boolean) => void } = {}) {
  const [urlOrg, setUrlOrg] = useState<string | null>(() => typeof window === "undefined" ? null : new URLSearchParams(window.location.search).get("orgId"));
  useFollowUrl(() => setUrlOrg(new URLSearchParams(window.location.search).get("orgId")));
  const scope = orgId ?? urlOrg;
  return <ConfirmProvider key={scope ?? "current-team"}><TeamDiscussion embedded={embedded} requestedOrg={scope} onBusyChange={onBusyChange} onDirtyChange={onDirtyChange} /></ConfirmProvider>;
}

function TeamDiscussion({ embedded, requestedOrg, onBusyChange, onDirtyChange }: { embedded: boolean; requestedOrg: string | null; onBusyChange?: (busy: boolean) => void; onDirtyChange?: (dirty: boolean) => void }) {
  const Root = embedded ? "section" : "main";
  const { view, error, notice, fetchFailed, busy: writing, refreshing, fromCache, cachedAt, load, mutate: write } = useCollabData(requestedOrg);
  const drafts = useRef(new Set<string>());
  const [dirty, setDirty] = useState(false);
  const confirm = useConfirm();
  const reportDraft = useCallback<ReportDiscussionDraft>((key, changed) => {
    if (changed) drafts.current.add(key); else drafts.current.delete(key);
    setDirty(drafts.current.size > 0);
  }, []);
  const discardOtherInputs = useCallback(() => confirm({ title: "Discard unsaved discussion inputs?", body: "Changing lists discards votes, team notes and list details you have not saved. The saved pick list stays intact.", confirmLabel: "Discard and open", cancelLabel: "Keep editing", tone: "destructive" }), [confirm]);
  const mutate: CollabMutate = useCallback(async payload => {
    if (payload.action === "create-list" && [...drafts.current].some(key => key !== "create-list") && !await discardOtherInputs()) return false;
    return write(payload);
  }, [write, discardOtherInputs]);
  const busy = writing || refreshing;
  const activeListId = view?.status === "live" ? view.activeList?.id ?? null : null;
  const fieldWeights = usePicklistFieldWeights(view?.status === "live" && view.currentUserId && activeListId ? `${view.currentUserId}:${activeListId}` : null);
  useEffect(() => { onBusyChange?.(writing); }, [onBusyChange, writing]);
  useEffect(() => { onDirtyChange?.(dirty); }, [onDirtyChange, dirty]);
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  useEffect(() => {
    if (!embedded || !activeListId) return;
    const url = new URL(window.location.href);
    url.searchParams.set("listId", activeListId);
    window.history.replaceState({}, "", `${url.pathname}${url.search}${url.hash}`);
  }, [activeListId, embedded]);

  const orgId = view && "orgId" in view ? view.orgId : null;
  const inScoutApp = useInScoutApp();
  const listCount = view?.status === "live" ? view.lists.length : 0;
  const totalEntries = view?.status === "live" ? view.summary.totalEntries : 0;

  const shell = classifyPicklistCollabShell({
    loading: view == null && !fetchFailed,
    fetchFailed,
    status: view?.status ?? null,
    orgId,
    listCount,
    setupStepIds: view?.status === "setup_required" ? view.steps.map((step) => step.id) : [],
  });
  const shellCopy = picklistCollabShellCopy(shell);
  const relatedLinks = inScoutApp || embedded
    ? []
    : picklistCollabRelatedLinks(orgId, {
        include: [...PICKLIST_COLLAB_RELATED_INCLUDE],
      });
  const competitionHref = hubWorkbenchHref("competition", "picklist-collab", orgId);
  const showTiles = shouldShowPicklistCollabSummaryTiles({ listCount, totalEntries });

  if (shell === "loading") {
    return (
      <CollabShell embedded={embedded} description={shellCopy.description} orgId={null} shell="loading">
        <OfflineBanner feature="Collaborative pick list" fromCache={fromCache} cachedAt={cachedAt} />
      </CollabShell>
    );
  }

  if (shell === "error") {
    return (
      <CollabShell
        embedded={embedded}
        description={shellCopy.description}
        orgId={orgId}
        shell="error"
        error={error || shellCopy.description}
        onRetry={() => load()}
      >
        <OfflineBanner feature="Collaborative pick list" fromCache={fromCache} cachedAt={cachedAt} />
        <Button type="button" variant="secondary" disabled={busy} onClick={() => load(null)}>Choose another saved list</Button>
      </CollabShell>
    );
  }

  if (shell === "setup") {
    const setupView = view?.status === "setup_required" ? view : null;
    const createStep = setupView?.steps.find((step) => step.id === "create-list");
    if (setupView?.orgId && createStep && setupView.eventKey && setupView.canManage) {
      return (
        <Root className="module-page picklist-collab-page">
          <PicklistHeader embedded={embedded}
            breadcrumbs={<Crumbs href={competitionHref} />}
            title="Collaborative pick list"
            description={setupView.message}
          >
            {embedded ? null : <RelatedStrip orgId={orgId} />}
          </PicklistHeader>
          <OfflineBanner feature="Collaborative pick list" fromCache={fromCache} cachedAt={cachedAt} />
          {error ? (
            <p className="telemetry-status" role="alert">
              {error}
            </p>
          ) : null}
          <CreateListForm
            busy={busy}
            mutate={mutate}
            eventKey={setupView.eventKey}
            eventName={setupView.eventName}
            reportDraft={reportDraft}
          />
        </Root>
      );
    }
    const guided = Boolean(setupView?.orgId && setupView.steps[0] && !createStep);
    return (
      <CollabShell
        embedded={embedded}
        description={setupView ? setupView.message : shellCopy.description}
        orgId={orgId}
        shell="setup"
        emptyTitle={setupView?.message}
        emptyDescription={guided ? setupView?.steps[0]?.detail : undefined}
        suppressSetupAction={Boolean(createStep && !setupView?.canManage)}
        action={guided && setupView?.steps[0] ? { href: setupView.steps[0].href, label: setupView.steps[0].label } : null}
      >
        <OfflineBanner feature="Collaborative pick list" fromCache={fromCache} cachedAt={cachedAt} />
        <Button type="button" variant="secondary" disabled={busy} onClick={() => load()}>Refresh access</Button>
      </CollabShell>
    );
  }

  return (
    <Root className="module-page picklist-collab-page">
      <PicklistHeader embedded={embedded}
        breadcrumbs={<Crumbs href={competitionHref} />}
        title="Collaborative pick list"
        description="Compare team evidence, discuss picks and record your vote. Scouting leads manage the saved ranking."
      >
        <div className="picklist-collab-header-actions">
          {view?.status === "live" && view.lists.length > 0 ? (
            <label className="app-muted picklist-collab-select">
              List
              <select
                value={view.activeList?.id ?? ""}
                disabled={busy}
                onChange={async (event) => {
                  const next = event.target.value;
                  if (drafts.current.size && !await discardOtherInputs()) return;
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
            <Button variant="secondary" type="button" onClick={() => { const csv = picklistToCsv({ listName: view.activeList!.name, entries: sortEntriesWithFieldRating(view.entries, [], undefined, undefined, "hand") }); const blob = new Blob([csv], { type: "text/csv;charset=utf-8" }); const url = URL.createObjectURL(blob); const link = document.createElement("a"); link.href = url; link.download = `${view.activeList!.name.replace(/[^\w.-]+/g, "-").replace(/^-|-$/g, "") || "picklist"}.csv`; link.click(); URL.revokeObjectURL(url); }}>
              Download CSV
            </Button>
          ) : null}
          {relatedLinks.map((link) => (
            <Button as="a" variant="secondary" key={link.id} href={link.href}>
              {link.label}
            </Button>
          ))}
        </div>
        <Button type="button" variant="secondary" disabled={busy} onClick={() => load()}>{refreshing ? "Refreshing…" : "Refresh saved list"}</Button>
      </PicklistHeader>

      <OfflineBanner feature="Collaborative pick list" fromCache={fromCache} cachedAt={cachedAt} />

      {error ? (
        <p className="telemetry-status" role="alert">
          {error}
        </p>
      ) : null}
      {notice ? <p className="picklist-feedback" role="status">{notice}</p> : null}

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
          {view?.canManage ? <CreateListForm busy={busy} mutate={mutate} reportDraft={reportDraft} /> : <p className="app-muted">Your scouting lead can create a list for this event.</p>}
        </div>
      ) : view?.status === "live" ? (
        <div className="picklist-collab-layout">
          <SummaryStatus key={view.activeList?.id} view={view} busy={busy} mutate={mutate} error={error} />
          <details className="picklist-comparison">
            <summary>Compare event metrics<span>Adjust weights and find teams to discuss</span></summary>
          <PicklistWeightSliders
            weights={fieldWeights.weights}
            fieldStats={view.fieldStats ?? {}}
            onWeight={fieldWeights.setWeight}
            onReset={fieldWeights.reset}
          />
          <PicklistEventRanking
            eventTeams={view.eventTeams ?? []}
            weights={fieldWeights.weights}
            fieldStats={view.fieldStats ?? {}}
            onList={new Set(view.entries.map((entry) => entry.teamNumber))}
            busy={busy}
            onAdd={(teamNumber) => mutate({ action: "add-entry", teamNumber, tier: "unranked" })}
            canAdd={Boolean(view.canManage && view.activeList?.status === "open")}
          />
          </details>
          {view.canManage && view.activeList?.status === "open" ? <details className="picklist-add-more">
            <summary data-disclosure>Add by team number</summary>
            <AddEntryForm key={activeListId} busy={busy} mutate={mutate} reportDraft={reportDraft} />
          </details> : null}
          <EntriesByTier
            view={view}
            busy={busy}
            mutate={mutate}
            weights={fieldWeights.weights}
            listKey={view.activeList?.id ?? "default"}
            key={view.activeList?.id ?? "default"}
            error={error}
            reportDraft={reportDraft}
          />
          {view.canManage ? <CreateListForm key={activeListId} busy={busy} mutate={mutate} collapsedLabel="Add another pick list" reportDraft={reportDraft} /> : null}
        </div>
      ) : null}
    </Root>
  );
}

function SummaryStatus({ view, busy, mutate, error }: { view: LiveView; busy: boolean; mutate: CollabMutate; error: string }) {
  const [pending, setPending] = useState<"locked" | "archived" | null>(null);
  const status = view.activeList?.status;
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
          {status ?? "—"}
        </Badge>
        {view.canManage ? <div className="picklist-status-actions">
          {status !== "open" ? <Button type="button" variant="secondary" disabled={busy || !view.activeList?.revision} onClick={() => void mutate({ action: "update-list-status", status: "open" })}>Reopen list</Button> : <Button type="button" variant="secondary" disabled={busy || !view.activeList?.revision} onClick={() => setPending("locked")}>Lock ranking and votes</Button>}
          {status !== "archived" ? <Button type="button" variant="ghost" disabled={busy || !view.activeList?.revision} onClick={() => setPending("archived")}>Archive list</Button> : null}
        </div> : null}
      </div>
      <p className="app-muted">{status === "open" ? "Members can vote and discuss. Scouting leads can change the ranking."
        : `This list is ${status ?? "read only"}. Its data is preserved; a scouting lead can reopen it to allow changes.`}</p>
      {!view.activeList?.revision ? <p className="app-muted">Refresh the saved list to load its current version before editing.</p> : null}
      <Modal open={pending !== null} onClose={() => { if (!busy) setPending(null); }} title={pending === "archived" ? "Archive this pick list?" : "Lock ranking and votes?"}>
        <p>The saved ranking, notes and votes remain available. New edits and votes stop until a scouting lead reopens this list.</p>
        {error ? <p role="alert">{error}</p> : null}
        <div className="app-actions"><Button type="button" variant="secondary" disabled={busy} onClick={() => setPending(null)}>Cancel</Button>
          <Button type="button" variant="primary" disabled={busy} onClick={async () => { if (pending && await mutate({ action: "update-list-status", status: pending })) setPending(null); }}>{busy ? "Saving…" : pending === "archived" ? "Archive list" : "Lock list"}</Button></div>
      </Modal>
    </Panel>
  );
}

function EntriesByTier({
  view,
  busy,
  mutate,
  weights,
  listKey,
  error,
  reportDraft,
}: {
  view: LiveView;
  busy: boolean;
  mutate: CollabMutate;
  weights: MetricWeight[];
  listKey: string;
  error: string;
  reportDraft: ReportDiscussionDraft;
}) {
  // "Sliders" re-sorts each tier as the sliders move; "My order" keeps what the team dragged.
  // Dragging switches to My order. Remembered per list on this device.
  const orderStorageKey = `vantage.picklist.order.v2:${view.currentUserId ?? "unknown"}:${view.orgId}:${listKey}`;
  const [mode, setMode] = useState<PicklistOrderMode>("hand");
  useEffect(() => {
    try {
      setMode(window.localStorage.getItem(orderStorageKey) === "sliders" ? "sliders" : "hand");
    } catch {
      setMode("hand");
    }
  }, [orderStorageKey]);
  const chooseMode = useCallback(
    (next: PicklistOrderMode) => {
      setMode(next);
      try {
        window.localStorage.setItem(orderStorageKey, next);
      } catch {
        /* storage blocked */
      }
    },
    [orderStorageKey],
  );

  const ranked = sortEntriesWithFieldRating(view.entries, weights, view.fieldStats ?? {}, view.eventTeams, mode);
  // Where each listed team sits in "Ranked by your sliders", so a row says
  // "7th of 23" instead of a bare comparison score.
  const sliderRank = new Map<string, number>();
  const sliderRanked = rankByWeightedZScores(view.eventTeams ?? [], weights, view.fieldStats ?? {}).filter(
    (row) => row.score != null,
  );
  sliderRanked.forEach((row, index) => sliderRank.set(row.teamKey, index + 1));
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
  const groups: TierGroup[] = PICKLIST_COLLAB_TIERS.map((tier) => ({
    tier,
    entries: ranked.filter((entry) => entry.tier === tier),
  }));
  return (
    <>
      <div className="picklist-order-switch" role="group" aria-label="How the list is ordered">
        <span className="app-muted">Order</span>
        <button type="button" aria-pressed={mode === "sliders"} onClick={() => chooseMode("sliders")}>
          By sliders
        </button>
        <button type="button" aria-pressed={mode === "hand"} onClick={() => chooseMode("hand")}>
          Saved team order
        </button>
      </div>
      {mode === "sliders" ? <p className="app-muted">This comparison uses your sliders on this device. The saved team order stays in place until a scouting lead saves the comparison.</p> : null}
      {mode === "sliders" && view.canManage && view.activeList?.status === "open" ? <Button type="button" variant="primary" disabled={busy || !view.activeList.revision} onClick={async () => { if (await mutate(orderPayload(groups))) chooseMode("hand"); }}>Save this order</Button> : null}
      <PicklistTierList
        groups={groups}
        sliderRank={sliderRank}
        sliderCount={sliderRanked.length}
        busy={busy}
        mutate={mutate}
        onReordered={() => chooseMode("hand")}
        canManage={Boolean(view.canManage && view.activeList?.revision && view.activeList.status === "open")}
        canVote={Boolean(view.currentUserId && view.activeList?.status === "open")}
        currentUserId={view.currentUserId}
        error={error}
        reportDraft={reportDraft}
      />
    </>
  );
}

function AddEntryForm({
  busy,
  mutate,
  reportDraft,
}: {
  busy: boolean;
  mutate: CollabMutate;
  reportDraft: ReportDiscussionDraft;
}) {
  const empty = useMemo(
    () => ({ teamNumber: "", tier: "unranked" as PicklistCollabTier, note: "" }),
    [],
  );
  const [form, setForm] = useState(empty);
  useDiscussionDraft("add-team", Boolean(form.teamNumber || form.note || form.tier !== "unranked"), reportDraft);
  const set = (key: keyof typeof form) => (event: { target: { value: string } }) =>
    setForm((prev) => ({ ...prev, [key]: event.target.value }));

  return (
    <Panel
      id="picklist-collab-add"
      as="form"
      className="picklist-collab-panel"
      onSubmit={async (event) => {
        event.preventDefault();
        if (!form.teamNumber) return;
        const saved = await mutate({
          action: "add-entry",
          teamNumber: Number(form.teamNumber),
          tier: form.tier,
          note: form.note.trim() || undefined,
        });
        if (saved) setForm(empty);
      }}
    >
      <h2 style={{ margin: 0 }}>Add team</h2>
      <FormGrid min={160}>
        <FormRow label="Team number">
          <input type="number" min={1} max={9999999} step={1} disabled={busy} value={form.teamNumber} onChange={set("teamNumber")} required />
        </FormRow>
        <FormRow label="Tier">
          <select disabled={busy} value={form.tier} onChange={set("tier")}>
            {PICKLIST_COLLAB_TIERS.map((tier) => (
              <option key={tier} value={tier}>
                {picklistCollabTierLabel(tier)}
              </option>
            ))}
          </select>
        </FormRow>
      </FormGrid>
      <FormRow label="Note (optional)">
        <textarea disabled={busy} maxLength={2000} value={form.note} onChange={set("note")} rows={2} />
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
  eventKey,
  eventName,
  reportDraft,
}: {
  busy: boolean;
  mutate: CollabMutate;
  collapsedLabel?: string;
  eventKey?: string | null;
  eventName?: string | null;
  reportDraft: ReportDiscussionDraft;
}) {
  const lockedEvent = eventKey?.trim() ?? "";
  const empty = useMemo(() => ({ name: "", eventKey: lockedEvent }), [lockedEvent]);
  const [form, setForm] = useState(empty);
  useDiscussionDraft("create-list", Boolean(form.name || form.eventKey !== lockedEvent), reportDraft);
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
      onSubmit={async (event) => {
        event.preventDefault();
        if (!form.name.trim()) return;
        // A blank event means the event the team is at — the server fills it in.
        const saved = await mutate({ action: "create-list", name: form.name, eventKey: lockedEvent || form.eventKey.trim() || null });
        if (saved) { setForm(empty); setOpen(!collapsedLabel); }
      }}
    >
      <h2 style={{ margin: 0 }}>Create pick list</h2>
      <FormGrid min={160}>
        <FormRow label="List name">
          <input disabled={busy} maxLength={200} value={form.name} onChange={set("name")} placeholder="Week 3 Regional" required />
        </FormRow>
        <FormRow
          label={lockedEvent ? "Event" : "Event (optional)"}
          hint={lockedEvent ? undefined : "Blank uses the event you are at. Or type an event code, like 2026miket."}
        >
          {lockedEvent ? (
            <input
              readOnly
              aria-label="Event"
              value={scoutEventLabel({ eventName, eventKey: lockedEvent }) ?? ""}
            />
          ) : (
            <input disabled={busy} maxLength={64} value={form.eventKey} onChange={set("eventKey")} placeholder="The event you are at" />
          )}
        </FormRow>
      </FormGrid>
      <div>
        <Button
          as="button"
          type="submit"
          variant="primary"
          disabled={busy || !form.name.trim()}
        >
          Create list
        </Button>
      </div>
    </Panel>
  );
}
