"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
  type BadgeTone,
} from "../../components/ui";
import type {
  EventCandidate,
  EventReadinessView,
} from "../../lib/event-readiness/compute-event-readiness";
import type { ReadinessFlag, ScheduledItem } from "../../lib/event-readiness/schedule";
import {
  READINESS_CATEGORIES,
  READINESS_SOURCE_HREFS,
  READINESS_STATUSES,
  readinessCategoryLabel,
  readinessStatusLabel,
  type ReadinessItem,
  type RollupSource,
} from "../../lib/event-readiness/types";
import { hubHref } from "../../lib/nav/hubs";
import { FEATURE_API_TIMEOUT_MS } from "../../lib/nav/resolve-org";
import { getFeatureSnapshot, putFeatureSnapshot } from "../../lib/offline/feature-cache";
import { withOrgHref } from "../../lib/nav/product-nav";
import "./event-readiness.css";

function isEventReadinessView(value: unknown): value is EventReadinessView {
  if (!value || typeof value !== "object") return false;
  const status = (value as { status?: unknown }).status;
  return status === "setup_required" || status === "live";
}

async function persistEventReadinessSnapshot(
  orgHint: string,
  data: EventReadinessView,
): Promise<void> {
  const cacheOrg =
    "orgId" in data && typeof data.orgId === "string" && data.orgId.trim() ? data.orgId : orgHint;
  if (!cacheOrg) return;
  const key = data.status === "live" ? data.plan.eventKey : "";
  try {
    await putFeatureSnapshot("event-readiness", cacheOrg, data, key);
    await putFeatureSnapshot("event-readiness", cacheOrg, data);
    if (!orgHint) {
      await putFeatureSnapshot("event-readiness", "_", data, key);
      await putFeatureSnapshot("event-readiness", "_", data);
    }
  } catch {
    // Live readiness already painted; IndexedDB is best-effort.
  }
}

type LiveView = Extract<EventReadinessView, { status: "live" }>;
type ScheduledReadinessItem = ScheduledItem<ReadinessItem>;

const PAGE_TITLE = "Event Readiness";
const PAGE_DESCRIPTION =
  "Remaining blockers for one event date — consent, packing, travel, and inspection roll up here and link back to the tool that owns each one.";

function flagTone(flag: ReadinessFlag): BadgeTone {
  if (flag === "done") return "good";
  if (flag === "overdue") return "demo";
  if (flag === "at_risk") return "setup";
  return "info";
}

function flagLabel(flag: ReadinessFlag): string {
  const labels: Record<ReadinessFlag, string> = {
    done: "Done",
    overdue: "Overdue",
    at_risk: "Due soon",
    scheduled: "Scheduled",
    no_date: "No date",
  };
  return labels[flag];
}

function formatGroupDate(isoDate: string): string {
  const date = new Date(`${isoDate}T00:00:00`);
  if (Number.isNaN(date.getTime())) return isoDate;
  return date.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
}

function daysBeforeLabel(days: number): string {
  if (days === 0) return "Event day";
  if (days < 0) return `${-days} day${days === -1 ? "" : "s"} after start`;
  return `${days} day${days === 1 ? "" : "s"} before`;
}

function sourceHref(item: ReadinessItem, orgId: string | null): string | null {
  if (item.sourceKind === "manual" || item.sourceKind === "template") return null;
  const base = READINESS_SOURCE_HREFS[item.sourceKind as RollupSource];
  return base ? withOrgHref(base, orgId) : null;
}

function Shell({
  orgId,
  children,
  headerExtra,
}: {
  orgId: string | null;
  children: React.ReactNode;
  headerExtra?: React.ReactNode;
}) {
  return (
    <main className="module-page evr-page">
      <PageHeader
        breadcrumbs={
          <>
            <a href={hubHref("/competition", "command", orgId)}>Competition</a>
            {" / Event Readiness"}
          </>
        }
        title={PAGE_TITLE}
        description={PAGE_DESCRIPTION}
      >
        {headerExtra}
      </PageHeader>
      {children}
    </main>
  );
}

export default function EventReadinessClient() {
  const [view, setView] = useState<EventReadinessView | null>(null);
  const [error, setError] = useState("");
  const [fetchFailed, setFetchFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [eventKey, setEventKey] = useState<string | null>(null);
  const [fromCache, setFromCache] = useState(false);
  const [cachedAt, setCachedAt] = useState<string | null>(null);
  const viewRef = useRef<EventReadinessView | null>(null);
  viewRef.current = view;

  const load = useCallback((overrides?: { eventKey?: string }) => {
    void (async () => {
      const params = new URLSearchParams(window.location.search);
      const urlOrg = params.get("orgId")?.trim() ?? "";
      const eventQuery = overrides?.eventKey ?? params.get("eventKey") ?? "";
      let hadCache = Boolean(viewRef.current);
      try {
        const cached =
          (await getFeatureSnapshot<EventReadinessView>(
            "event-readiness",
            urlOrg || "_",
            eventQuery,
          )) ??
          (eventQuery
            ? await getFeatureSnapshot<EventReadinessView>("event-readiness", urlOrg || "_")
            : null);
        if (!viewRef.current && cached?.data && isEventReadinessView(cached.data)) {
          setView(cached.data);
          if (cached.data.status === "live") setEventKey(cached.data.plan.eventKey);
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
      if (eventQuery) query.set("eventKey", eventQuery);
      try {
        const response = await fetch(
          `/api/event-readiness${query.toString() ? `?${query.toString()}` : ""}`,
          {
            cache: "no-store",
            signal: AbortSignal.timeout(FEATURE_API_TIMEOUT_MS),
          },
        );
        const data = (await response.json()) as EventReadinessView | { error?: string };
        if (!response.ok || !isEventReadinessView(data)) {
          if (hadCache || viewRef.current) {
            setFromCache(true);
            setError("Could not refresh Event readiness. Showing the last copy on this device.");
            setFetchFailed(false);
          } else {
            setFetchFailed(true);
          }
          return;
        }
        setView(data);
        if (data.status === "live") setEventKey(data.plan.eventKey);
        setFromCache(false);
        setCachedAt(null);
        await persistEventReadinessSnapshot(urlOrg, data);
      } catch {
        if (hadCache || viewRef.current) {
          setFromCache(true);
          setError("Could not refresh Event readiness. Showing the last copy on this device.");
          setFetchFailed(false);
        } else {
          setFetchFailed(true);
        }
      }
    })();
  }, []);

  useEffect(() => {
    load();
     
  }, []);

  const orgId = view && "orgId" in view ? view.orgId : null;

  const mutate = useCallback(
    async (payload: Record<string, unknown>) => {
      if (!orgId || busy) return;
      setBusy(true);
      setError("");
      try {
        const response = await fetch("/api/event-readiness", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ orgId, eventKey: eventKey ?? undefined, ...payload }),
          signal: AbortSignal.timeout(FEATURE_API_TIMEOUT_MS),
        });
        const data = (await response.json()) as EventReadinessView | { error?: string };
        if (!response.ok || !("status" in data)) {
          setError("error" in data && data.error ? data.error : "Something went wrong.");
          return;
        }
        setView(data);
        if (data.status === "live") setEventKey(data.plan.eventKey);
        void persistEventReadinessSnapshot(orgId, data);
      } catch {
        setError("Network error — please try again.");
      } finally {
        setBusy(false);
      }
    },
    [orgId, busy, eventKey],
  );

  if (!view) {
    if (!fetchFailed) {
      return (
        <Shell orgId={null}>
          <OfflineBanner feature="Event readiness" fromCache={fromCache} cachedAt={cachedAt} />
          <div aria-busy="true" aria-label="Loading event readiness">
            <SoftBlockSkeleton lines={4} />
          </div>
        </Shell>
      );
    }
    return (
      <Shell orgId={orgId}>
        <OfflineBanner feature="Event readiness" fromCache={fromCache} cachedAt={cachedAt} />
        <ErrorState message="Could not load event readiness." onRetry={() => load()} />
      </Shell>
    );
  }

  if (view.status === "setup_required") {
    return (
      <Shell orgId={orgId}>
        <OfflineBanner feature="Event readiness" fromCache={fromCache} cachedAt={cachedAt} />
        {error ? (
          <p className="telemetry-status" role="alert">
            {error}
          </p>
        ) : null}
        <EmptyState
          soft
          badge="Setup required"
          badgeTone="setup"
          title="No readiness plan yet"
          description={view.message}
        >
          {view.steps[0] && view.steps[0].href !== "/event-readiness" ? (
            <Button as="a" variant="primary" href={withOrgHref(view.steps[0].href, orgId)}>
              {view.steps[0].label}
            </Button>
          ) : null}
        </EmptyState>
        {orgId ? (
          <CreatePlanForm busy={busy} mutate={mutate} candidates={view.eventCandidates} onCreated={setEventKey} />
        ) : null}
      </Shell>
    );
  }

  return (
    <LivePlan
      view={view}
      busy={busy}
      error={error}
      fromCache={fromCache}
      cachedAt={cachedAt}
      mutate={mutate}
      onPickEvent={(key) => {
        setEventKey(key);
        load({ eventKey: key });
      }}
    />
  );
}

function CreatePlanForm({
  busy,
  mutate,
  candidates,
  onCreated,
}: {
  busy: boolean;
  mutate: (payload: Record<string, unknown>) => void;
  candidates: EventCandidate[];
  onCreated: (eventKey: string) => void;
}) {
  const first = candidates[0] ?? null;
  const [selectedKey, setSelectedKey] = useState<string>(first ? first.eventKey : "__manual__");
  const [manualKey, setManualKey] = useState("");
  const [startDate, setStartDate] = useState(first?.startDate ?? "");
  const [eventName, setEventName] = useState("");

  const selectedCandidate = candidates.find((c) => c.eventKey === selectedKey) ?? null;
  const effectiveKey = selectedKey === "__manual__" ? manualKey.trim() : selectedKey;
  const needsDate = !selectedCandidate?.startDate;
  const canSubmit = Boolean(effectiveKey) && (!needsDate || Boolean(startDate));

  return (
    <Panel
      as="form"
      className="evr-panel"
      aria-label="Start a readiness plan"
      onSubmit={(event) => {
        event.preventDefault();
        if (!canSubmit) return;
        onCreated(effectiveKey);
        mutate({
          action: "create-plan",
          eventKey: effectiveKey,
          eventName: eventName.trim() || undefined,
          eventStartDate: startDate || undefined,
        });
      }}
    >
      <h2 className="evr-panel-title">Start a plan</h2>
      <p className="app-muted evr-tip">
        Seeds the standard pre-event checklist — every step dated back from the event start.
      </p>
      <FormGrid min={200}>
        <FormRow label="Event">
          <select
            value={selectedKey}
            onChange={(event) => {
              const key = event.target.value;
              setSelectedKey(key);
              const candidate = candidates.find((c) => c.eventKey === key);
              setStartDate(candidate?.startDate ?? "");
            }}
          >
            {candidates.map((candidate) => (
              <option key={candidate.eventKey} value={candidate.eventKey}>
                {candidate.eventName ? `${candidate.eventName} (${candidate.eventKey})` : candidate.eventKey}
              </option>
            ))}
            <option value="__manual__">Enter an event key by hand…</option>
          </select>
        </FormRow>
        {selectedKey === "__manual__" ? (
          <FormRow label="Event key">
            <input
              value={manualKey}
              onChange={(event) => setManualKey(event.target.value)}
              placeholder="2026casj or week-0-scrimmage"
              required
            />
          </FormRow>
        ) : null}
        <FormRow label={needsDate ? "Event start date" : "Event start date (from reference data)"}>
          <input
            type="date"
            value={startDate}
            onChange={(event) => setStartDate(event.target.value)}
            required={needsDate}
          />
        </FormRow>
        <FormRow label="Event name (optional)">
          <input
            value={eventName}
            onChange={(event) => setEventName(event.target.value)}
            placeholder="Silicon Valley Regional"
          />
        </FormRow>
      </FormGrid>
      <div>
        <Button type="submit" variant="primary" disabled={busy || !canSubmit}>
          Start a plan for this event
        </Button>
      </div>
    </Panel>
  );
}

function remainingHeadline(view: LiveView): string {
  const date = formatGroupDate(view.plan.eventStartDate);
  if (view.remaining == null) {
    const unknown = view.blockers.unknownSources.length;
    return `Remaining blockers for ${date} cannot be totaled yet — ${unknown} source${unknown === 1 ? "" : "s"} ${unknown === 1 ? "has" : "have"} no honest count.`;
  }
  if (view.remaining === 0) {
    return `0 remaining blockers for ${date} — consent, packing, travel, and inspection are clear.`;
  }
  return `${view.remaining} remaining blocker${view.remaining === 1 ? "" : "s"} for ${date}.`;
}

function RemainingBlockers({ view }: { view: LiveView }) {
  return (
    <Panel className="evr-panel evr-remaining" aria-label="Remaining blockers for this event">
      <header className="evr-remaining-head">
        <p className="app-muted evr-tip">Remaining blockers</p>
        <strong className="evr-remaining-value">
          {view.remaining == null ? "Unknown" : view.remaining}
        </strong>
        <p className="evr-remaining-headline">{remainingHeadline(view)}</p>
      </header>
      <ul className="evr-remaining-list">
        {view.sources.map((source) => (
          <li key={source.source} className={`evr-remaining-row ${source.state}`}>
            <div>
              <strong>{source.label}</strong>
              <p className="app-muted evr-tip">{source.detail}</p>
            </div>
            <div className="evr-remaining-row-meta">
              {source.remaining == null ? (
                <Badge tone="setup">{source.state === "not_set_up" ? "Not set up yet" : "Unknown"}</Badge>
              ) : source.remaining === 0 ? (
                <Badge tone="good">Clear</Badge>
              ) : (
                <Badge tone="demo">{source.remaining} remaining</Badge>
              )}
              <Button as="a" variant="secondary" href={withOrgHref(source.href, view.orgId)}>
                {source.state === "not_set_up" ? `Set up in ${source.label}` : `Open ${source.label}`}
              </Button>
            </div>
          </li>
        ))}
      </ul>
    </Panel>
  );
}

function LivePlan({
  view,
  busy,
  error,
  fromCache,
  cachedAt,
  mutate,
  onPickEvent,
}: {
  view: LiveView;
  busy: boolean;
  error: string;
  fromCache: boolean;
  cachedAt: string | null;
  mutate: (payload: Record<string, unknown>) => void;
  onPickEvent: (eventKey: string) => void;
}) {
  const { plan, countdown } = view;
  const daysToEvent = useMemo(() => {
    const start = new Date(`${plan.eventStartDate}T00:00:00Z`).getTime();
    const today = new Date(`${view.today}T00:00:00Z`).getTime();
    return Math.round((start - today) / 86_400_000);
  }, [plan.eventStartDate, view.today]);

  return (
    <main className="module-page evr-page">
      <PageHeader
        breadcrumbs={
          <>
            <a href={hubHref("/competition", "command", view.orgId)}>Competition</a>
            {" / Event Readiness"}
          </>
        }
        title={plan.eventName || plan.eventKey}
        description={
          daysToEvent > 0
            ? `${plan.eventKey} starts ${formatGroupDate(plan.eventStartDate)} — ${daysToEvent} day${daysToEvent === 1 ? "" : "s"} out.`
            : daysToEvent === 0
              ? `${plan.eventKey} starts today.`
              : `${plan.eventKey} started ${formatGroupDate(plan.eventStartDate)}.`
        }
      >
        {view.plans.length > 1 ? (
          <label className="app-muted evr-filter">
            Event
            <select value={plan.eventKey} onChange={(event) => onPickEvent(event.target.value)}>
              {view.plans.map((ref) => (
                <option key={ref.id} value={ref.eventKey}>
                  {ref.eventName || ref.eventKey}
                </option>
              ))}
            </select>
          </label>
        ) : null}
      </PageHeader>

      <OfflineBanner feature="Event readiness" fromCache={fromCache} cachedAt={cachedAt} />

      {error ? (
        <p className="telemetry-status" role="alert">
          {error}
        </p>
      ) : null}

      <RemainingBlockers view={view} />

      {view.categories.length > 0 ? (
        <section className="evr-stats" aria-label="Checklist progress by category">
          <StatTile label="Overdue" value={String(countdown.overdueCount)} />
          <StatTile label="Due soon" value={String(countdown.atRiskCount)} />
          {view.categories.map((row) => (
            <StatTile
              key={row.category}
              label={readinessCategoryLabel(row.category)}
              value={`${row.done}/${row.total}`}
            />
          ))}
        </section>
      ) : null}

      {countdown.groups.length === 0 && countdown.undated.length === 0 ? (
        <EmptyState
          soft
          badge="Empty plan"
          badgeTone="setup"
          title="This plan has no checklist items"
          description="Add the first item below — give it a due date or a days-before offset so it lands on the countdown."
        />
      ) : null}

      {countdown.groups.map((group) => (
        <Panel key={group.dueOn} className="evr-panel" aria-label={`Due ${group.dueOn}`}>
          <header className="evr-group-head">
            <h2 className="evr-panel-title">{formatGroupDate(group.dueOn)}</h2>
            <span className="app-muted">{daysBeforeLabel(group.daysBeforeEvent)}</span>
          </header>
          <ul className="evr-item-list">
            {group.items.map((item) => (
              <ItemRow key={item.id} item={item} orgId={view.orgId} busy={busy} mutate={mutate} />
            ))}
          </ul>
        </Panel>
      ))}

      {countdown.undated.length > 0 ? (
        <Panel className="evr-panel" aria-label="Items without a date">
          <header className="evr-group-head">
            <h2 className="evr-panel-title">No date</h2>
            <span className="app-muted">Not on the countdown — give these a date or a days-before offset.</span>
          </header>
          <ul className="evr-item-list">
            {countdown.undated.map((item) => (
              <ItemRow key={item.id} item={item} orgId={view.orgId} busy={busy} mutate={mutate} />
            ))}
          </ul>
        </Panel>
      ) : null}

      <AddItemForm busy={busy} mutate={mutate} planId={plan.id} />
    </main>
  );
}

function ItemRow({
  item,
  orgId,
  busy,
  mutate,
}: {
  item: ScheduledReadinessItem;
  orgId: string;
  busy: boolean;
  mutate: (payload: Record<string, unknown>) => void;
}) {
  const link = sourceHref(item, orgId);
  const closed = item.status === "done" || item.status === "not_applicable";
  return (
    <li className={`evr-item flag-${item.flag}`}>
      <div className="evr-item-main">
        <div className="evr-item-badges">
          <Badge tone={flagTone(item.flag)}>{flagLabel(item.flag)}</Badge>
          <Badge tone="neutral">{readinessCategoryLabel(item.category)}</Badge>
        </div>
        <strong className="evr-item-title">{item.title}</strong>
        {item.detail ? <p className="app-muted evr-tip">{item.detail}</p> : null}
        <small className="app-muted">
          {readinessStatusLabel(item.status)}
          {item.status === "blocked" && item.blockedReason ? ` — ${item.blockedReason}` : ""}
          {item.ownerName ? ` · ${item.ownerName}` : ""}
        </small>
      </div>
      <div className="evr-item-actions">
        {link ? (
          <Button as="a" variant="secondary" href={link}>
            Open {readinessCategoryLabel(item.category)}
          </Button>
        ) : null}
        {!closed ? (
          <Button
            variant="ghost"
            size="sm"
            disabled={busy}
            onClick={() => mutate({ action: "set-status", itemId: item.id, status: "done" })}
          >
            Mark done
          </Button>
        ) : null}
        <select
          className="evr-status-select"
          aria-label={`Status for ${item.title}`}
          value={item.status}
          disabled={busy}
          onChange={(event) => {
            const status = event.target.value;
            const blockedReason =
              status === "blocked" ? window.prompt("What is blocking this?", item.blockedReason) ?? "" : undefined;
            mutate({ action: "set-status", itemId: item.id, status, blockedReason });
          }}
        >
          {READINESS_STATUSES.map((status) => (
            <option key={status} value={status}>
              {readinessStatusLabel(status)}
            </option>
          ))}
        </select>
        <Button
          variant="ghost"
          size="sm"
          disabled={busy}
          onClick={() => {
            if (window.confirm(`Delete "${item.title}"?`)) {
              mutate({ action: "delete-item", itemId: item.id });
            }
          }}
        >
          Delete
        </Button>
      </div>
    </li>
  );
}

function AddItemForm({
  busy,
  mutate,
  planId,
}: {
  busy: boolean;
  mutate: (payload: Record<string, unknown>) => void;
  planId: string;
}) {
  const empty = useMemo(
    () => ({ title: "", category: "other", detail: "", dueOn: "", daysBefore: "" }),
    [],
  );
  const [form, setForm] = useState(empty);
  const set = (key: keyof typeof form) => (event: { target: { value: string } }) =>
    setForm((prev) => ({ ...prev, [key]: event.target.value }));

  return (
    <Panel
      as="form"
      className="evr-panel"
      aria-label="Add checklist item"
      onSubmit={(event) => {
        event.preventDefault();
        if (!form.title.trim()) return;
        mutate({
          action: "add-item",
          planId,
          title: form.title,
          category: form.category,
          detail: form.detail || undefined,
          dueOn: form.dueOn || undefined,
          daysBefore: form.dueOn ? undefined : form.daysBefore === "" ? undefined : Number(form.daysBefore),
        });
        setForm(empty);
      }}
    >
      <h2 className="evr-panel-title">Add item</h2>
      <FormGrid min={160}>
        <FormRow label="Title">
          <input value={form.title} onChange={set("title")} placeholder="Print match schedules" required />
        </FormRow>
        <FormRow label="Category">
          <select value={form.category} onChange={set("category")}>
            {READINESS_CATEGORIES.map((category) => (
              <option key={category} value={category}>
                {readinessCategoryLabel(category)}
              </option>
            ))}
          </select>
        </FormRow>
        <FormRow label="Due date (optional)">
          <input type="date" value={form.dueOn} onChange={set("dueOn")} />
        </FormRow>
        <FormRow label="Or days before event">
          <input
            type="number"
            min={0}
            max={365}
            value={form.daysBefore}
            onChange={set("daysBefore")}
            placeholder="3"
            disabled={Boolean(form.dueOn)}
          />
        </FormRow>
      </FormGrid>
      <FormRow label="Detail (optional)">
        <textarea value={form.detail} onChange={set("detail")} rows={2} />
      </FormRow>
      <div>
        <Button type="submit" variant="secondary" disabled={busy || !form.title.trim()}>
          Add item
        </Button>
      </div>
    </Panel>
  );
}
