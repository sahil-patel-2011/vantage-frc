"use client";

// Grant calendar: upcoming deadlines, honest eligibility chips, and a per-member watch that
// turns into 30/14/3-day alerts. Deliberately a separate route from the grant WRITING
// workbench at /team/grants — finding a grant and writing one are different jobs on
// different days, and the calendar has to load without the writing view's AI machinery.

import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { OfflineBanner } from "../../../../components/offline-banner";
import { Badge, EmptyState, PageHeader, Panel, Button } from "../../../../components/ui";
import { BusinessRelated } from "../../../../components/business-related";
import type {
  GrantCalendarEntry,
  GrantCalendarView,
} from "../../../../lib/grants-calendar/compute-grants-calendar";
import { urgencyLabel } from "../../../../lib/grants-calendar/eligibility";
import type { DeadlineUrgency } from "../../../../lib/grants-calendar/types";
import { FEATURE_API_TIMEOUT_MS } from "../../../../lib/nav/resolve-org";
import { withOrgHref } from "../../../../lib/nav/product-nav";
import { getFeatureSnapshot, putFeatureSnapshot } from "../../../../lib/offline/feature-cache";
import { classifyLoadFailure, loadFailureCopy } from "../../../../lib/ui/load-failure";
import "./calendar.css";

type Filter = "all" | "open" | "eligible" | "watching";

const FILTERS: Array<{ id: Filter; label: string }> = [
  { id: "open", label: "Open now" },
  { id: "eligible", label: "Eligible" },
  { id: "watching", label: "Watching" },
  { id: "all", label: "All" },
];

function urgencyTone(urgency: DeadlineUrgency): "danger" | "info" | "neutral" | "good" {
  if (urgency === "closing-3") return "danger";
  if (urgency === "closing-14") return "danger";
  if (urgency === "closing-30") return "info";
  if (urgency === "open") return "good";
  return "neutral";
}

function eligibilityBadge(entry: GrantCalendarEntry) {
  if (entry.eligible === true) {
    return <Badge tone="good">Eligible</Badge>;
  }
  if (entry.eligible === false) {
    return <Badge tone="neutral">Not eligible</Badge>;
  }
  // The whole point: "unknown" is shown as unknown, never rounded to a yes or a no.
  return <Badge tone="setup">Eligibility unknown</Badge>;
}

function money(value: number | null): string | null {
  if (value === null || value <= 0) return null;
  return `$${Math.round(value).toLocaleString("en-US")}`;
}

function isGrantCalendarView(value: unknown): value is GrantCalendarView {
  if (!value || typeof value !== "object") return false;
  const status = (value as { status?: unknown }).status;
  return status === "setup_required" || status === "live";
}

function responseError(data: unknown): string {
  return data && typeof data === "object" && "error" in data && typeof data.error === "string"
    ? data.error
    : "";
}

function grantsCalendarCacheOrg(data: GrantCalendarView, orgHint: string): string {
  switch (data.status) {
    case "setup_required":
      return (typeof data.orgId === "string" && data.orgId.trim()) || orgHint;
    case "live":
      return data.orgId.trim() || orgHint;
    default: {
      data satisfies never;
      return orgHint;
    }
  }
}

async function persistGrantCalendarSnapshot(
  orgHint: string,
  seasonHint: string,
  data: GrantCalendarView,
): Promise<void> {
  const cacheOrg = grantsCalendarCacheOrg(data, orgHint);
  if (!cacheOrg) return;
  const variant = data.status === "live" ? String(data.seasonYear) : seasonHint;
  try {
    await putFeatureSnapshot("grants-calendar", cacheOrg, data, variant);
    if (!orgHint) await putFeatureSnapshot("grants-calendar", "_", data, variant);
  } catch {
    // Live Grant calendar already painted; IndexedDB is best-effort.
  }
}

function GrantCalendarRelated({ orgId }: { orgId?: string | null }) {
  if (!orgId) return null;
  return (
    <BusinessRelated
      orgId={orgId}
      include={["grant-workbench", "writer", "sponsors", "fundraisers"]}
      ariaLabel="Related grant tools"
    />
  );
}

function GrantCalendarNextActions({ orgId }: { orgId: string }) {
  const actions = [
    {
      id: "write",
      label: "Open Grant writing",
      detail: "Turn a watched deadline into a draft while the facts are still on this phone.",
      href: withOrgHref("/team/grants", orgId),
      primary: true,
    },
    {
      id: "background",
      label: "Open Team background",
      detail: "Eligibility chips stay unknown until student count, Title I, and 501(c)(3) are recorded.",
      href: withOrgHref("/team/background", orgId),
    },
    {
      id: "writer",
      label: "Open Writer",
      detail: "Grant drafts pull from the same team facts this calendar uses.",
      href: withOrgHref("/writer", orgId),
    },
  ];
  return (
    <section className="app-card soft-panel edc-next-actions" aria-label="Next actions">
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

export default function GrantCalendarClient({ orgId: orgIdProp }: { orgId?: string }) {
  const [view, setView] = useState<GrantCalendarView | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>("open");
  const [showAdd, setShowAdd] = useState(false);
  const [fetchFailed, setFetchFailed] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [errorStatus, setErrorStatus] = useState<number | null>(null);
  const [fromCache, setFromCache] = useState(false);
  const [cachedAt, setCachedAt] = useState<string | null>(null);
  const viewRef = useRef<GrantCalendarView | null>(null);
  viewRef.current = view;

  const orgParam = useCallback(() => {
    if (orgIdProp) return orgIdProp;
    if (typeof window === "undefined") return null;
    return new URLSearchParams(window.location.search).get("orgId");
  }, [orgIdProp]);

  const load = useCallback(async () => {
    const orgHint = orgParam()?.trim() ?? "";
    const seasonHint = String(new Date().getFullYear());
    let hadCache = Boolean(viewRef.current);
    try {
      const cached = await getFeatureSnapshot<GrantCalendarView>(
        "grants-calendar",
        orgHint || "_",
        seasonHint,
      );
      if (!viewRef.current && cached?.data && isGrantCalendarView(cached.data)) {
        setView(cached.data);
        setFromCache(true);
        setCachedAt(cached.cachedAt);
        hadCache = true;
      }
    } catch {
      // IndexedDB missing or blocked; live fetch still runs.
    }
    setFetchFailed(false);
    setLoadError("");
    setErrorStatus(null);
    setError("");
    try {
      const query = orgHint ? `?orgId=${encodeURIComponent(orgHint)}` : "";
      const response = await fetch(`/api/grants-calendar${query}`, {
        cache: "no-store",
        signal: AbortSignal.timeout(FEATURE_API_TIMEOUT_MS),
      });
      const data: unknown = await response.json().catch(() => null);
      if (response.status === 401 || response.status === 403) {
        setView(null);
        setFromCache(false);
        setCachedAt(null);
        setFetchFailed(true);
        setErrorStatus(response.status);
        setLoadError(responseError(data));
        return;
      }
      if (!response.ok || !isGrantCalendarView(data)) {
        if (hadCache || viewRef.current) {
          setFromCache(true);
          setError("Could not refresh Grant calendar. Showing the last copy on this device.");
          setFetchFailed(false);
          return;
        }
        setFetchFailed(true);
        setErrorStatus(response.status);
        setLoadError(
          responseError(data) ||
            (response.status === 401
              ? "Your session expired. Sign in again to open the grant calendar."
              : "Could not load the grant calendar."),
        );
        return;
      }
      setView(data);
      setFromCache(false);
      setCachedAt(null);
      const variant = data.status === "live" ? String(data.seasonYear) : seasonHint;
      await persistGrantCalendarSnapshot(orgHint, variant, data);
    } catch {
      if (hadCache || viewRef.current) {
        setFromCache(true);
        setError("Could not refresh Grant calendar. Showing the last copy on this device.");
        setFetchFailed(false);
        return;
      }
      setFetchFailed(true);
      setLoadError(
        "Could not reach the grant calendar. Check your connection and try again — no deadline is ever guessed offline.",
      );
    }
  }, [orgParam]);

  useEffect(() => {
    void load();
  }, [load]);

  const live = view?.status === "live" ? view : null;
  const orgId = view && "orgId" in view ? view.orgId : orgIdProp ?? null;

  const post = useCallback(
    async (body: Record<string, unknown>, busyKey: string) => {
      const org = live?.orgId ?? orgParam();
      if (!org) return;
      setBusyId(busyKey);
      setError("");
      setNotice("");
      try {
        const response = await fetch("/api/grants-calendar", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...body, orgId: org }),
          signal: AbortSignal.timeout(FEATURE_API_TIMEOUT_MS),
        });
        const data: unknown = await response.json().catch(() => null);
        if (!response.ok || !isGrantCalendarView(data)) {
          setError(responseError(data) || "That change did not save.");
          return;
        }
        setView(data);
        setFromCache(false);
        void persistGrantCalendarSnapshot(org, data.status === "live" ? String(data.seasonYear) : "", data);
        return data;
      } catch {
        setError("That change did not save — check your connection and try again.");
      } finally {
        setBusyId(null);
      }
    },
    [live?.orgId, orgParam],
  );

  const toggleWatch = useCallback(
    async (entry: GrantCalendarEntry) => {
      const next = !entry.watching;
      const result = await post(
        { action: "set-watch", opportunityId: entry.opportunity.id, watching: next, notify: next },
        entry.opportunity.id,
      );
      if (result) {
        setNotice(
          next
            ? `Watching ${entry.opportunity.name}. We will email you 30, 14, and 3 days before it closes.`
            : `Stopped watching ${entry.opportunity.name}.`,
        );
      }
    },
    [post],
  );

  const entries = useMemo(() => {
    if (!live) return [];
    switch (filter) {
      case "open":
        return live.entries.filter(
          (entry) => entry.urgency !== "closed" && entry.urgency !== "no-date",
        );
      case "eligible":
        return live.entries.filter((entry) => entry.eligible !== false);
      case "watching":
        return live.entries.filter((entry) => entry.watching);
      case "all":
        return live.entries;
      default: {
        filter satisfies never;
        return live.entries;
      }
    }
  }, [live, filter]);

  const header = (
    <PageHeader
      breadcrumbs="Business / Grants / Calendar"
      title="Grant calendar"
      description={
        live
          ? `${live.platformCount} maintained ${
              live.platformCount === 1 ? "grant" : "grants"
            }${live.teamCount > 0 ? ` plus ${live.teamCount} your team added` : ""}. Watch one and we email you 30, 14, and 3 days before it closes.`
          : "Upcoming grant deadlines with eligibility from recorded team facts only."
      }
    >
      <GrantCalendarRelated orgId={orgId} />
    </PageHeader>
  );

  if (!view) {
    const failure = fetchFailed
      ? loadFailureCopy(
          classifyLoadFailure({
            status: errorStatus,
            message: loadError,
            online: typeof navigator === "undefined" ? true : navigator.onLine,
          }),
          {
            nextPath:
              typeof window === "undefined"
                ? null
                : `${window.location.pathname}${window.location.search}`,
            message: loadError,
          },
        )
      : null;
    return (
      <main className="module-page grant-cal-page content">
        {header}
        <OfflineBanner feature="Grant calendar" fromCache={fromCache} cachedAt={cachedAt} />
        <EmptyState
          soft
          title={failure ? failure.title : "Opening the grant calendar…"}
          description={
            failure
              ? failure.description
              : "Deadlines come from recorded calendar rows only — nothing is estimated."
          }
          aria-busy={!fetchFailed}
        >
          {failure?.primary ? (
            <Button as="a" variant="primary" href={failure.primary.href}>
              {failure.primary.label}
            </Button>
          ) : null}
          {failure?.showRetry ? (
            <Button variant="primary" type="button" onClick={() => void load()}>
              Try again
            </Button>
          ) : null}
        </EmptyState>
      </main>
    );
  }

  switch (view.status) {
    case "setup_required":
      return (
        <main className="module-page grant-cal-page content soft-gate">
          {header}
          <OfflineBanner feature="Grant calendar" fromCache={fromCache} cachedAt={cachedAt} />
          <EmptyState soft badge="Setup required" badgeTone="setup" title="Choose your team">
            {view.steps[0] ? (
              <Button as="a" variant="primary" href={view.steps[0].href}>
                {view.steps[0].label}
              </Button>
            ) : null}
          </EmptyState>
        </main>
      );
    case "live":
      break;
    default: {
      view satisfies never;
      return null;
    }
  }

  return (
    <main className="module-page grant-cal-page content">
      {header}
      <OfflineBanner feature="Grant calendar" fromCache={fromCache} cachedAt={cachedAt} />

      {error ? (
        <p className="app-error" role="alert">
          {error}
        </p>
      ) : null}
      {notice ? (
        <p className="app-notice" role="status">
          {notice}
        </p>
      ) : null}

      {view.profileGaps.length > 0 ? (
        <Panel className="grant-cal-gaps">
          <h2>Why some grants say “eligibility unknown”</h2>
          <p className="app-muted">
            We will not guess. Record these and the chips below turn into real answers:
          </p>
          <ul>
            {view.profileGaps.map((gap) => (
              <li key={gap}>{gap}</li>
            ))}
          </ul>
          {view.canManage ? (
            <EligibilityFactsForm
              titleI={view.profile.titleI}
              nonprofit501c3={view.profile.nonprofit501c3}
              busy={busyId === "facts"}
              onSave={async (facts) => {
                const result = await post(
                  { action: "set-eligibility-facts", ...facts },
                  "facts",
                );
                if (result) setNotice("Eligibility facts saved.");
              }}
            />
          ) : null}
        </Panel>
      ) : null}

      <div className="grant-cal-filters" role="group" aria-label="Filter grants">
        {FILTERS.map((option) => (
          <button
            key={option.id}
            type="button"
            className={`grant-cal-filter${filter === option.id ? " is-active" : ""}`}
            aria-pressed={filter === option.id}
            onClick={() => setFilter(option.id)}
          >
            {option.label}
          </button>
        ))}
      </div>

      {entries.length === 0 ? (
        <EmptyState
          soft
          title={
            view.entries.length === 0
              ? "No grants on the calendar yet"
              : "Nothing matches this filter"
          }
          description={
            view.entries.length === 0
              ? "No grants added yet. Owners and admins can add a grant your team found, with its deadline."
              : "Try “All” to see closed and undated grants too."
          }
        />
      ) : (
        <ul className="grant-cal-list">
          {entries.map((entry) => (
            <GrantRow
              key={entry.opportunity.id}
              entry={entry}
              busy={busyId === entry.opportunity.id}
              canManage={view.canManage}
              onToggleWatch={() => void toggleWatch(entry)}
              onRemove={() =>
                void post(
                  { action: "remove-opportunity", opportunityId: entry.opportunity.id },
                  entry.opportunity.id,
                )
              }
            />
          ))}
        </ul>
      )}

      {view.canManage ? (
        <Panel className="grant-cal-add">
          <Button variant="ghost" type="button" aria-expanded={showAdd} onClick={() => setShowAdd((open) => !open)}>
            {showAdd ? "Cancel" : "Add a grant your team found"}
          </Button>
          {showAdd ? (
            <AddOpportunityForm
              busy={busyId === "add"}
              onSubmit={async (fields) => {
                const result = await post({ action: "add-opportunity", ...fields }, "add");
                if (result) {
                  setShowAdd(false);
                  setNotice(`${fields.name} added to your team's calendar.`);
                }
              }}
            />
          ) : null}
        </Panel>
      ) : null}

      <GrantCalendarNextActions orgId={view.orgId} />
    </main>
  );
}

function GrantRow({
  entry,
  busy,
  canManage,
  onToggleWatch,
  onRemove,
}: {
  entry: GrantCalendarEntry;
  busy: boolean;
  canManage: boolean;
  onToggleWatch: () => void;
  onRemove: () => void;
}) {
  const { opportunity } = entry;
  const amount = money(opportunity.typicalAmountUsd);
  const unknownReasons = entry.reasons.filter((reason) => reason.verdict === "unknown");
  const blockingReasons = entry.reasons.filter((reason) => reason.verdict === "ineligible");

  return (
    <li className={`grant-cal-row urgency-${entry.urgency}`}>
      <div className="grant-cal-row-head">
        <div>
          <h3>
            {opportunity.url ? (
              <a href={opportunity.url} target="_blank" rel="noopener noreferrer">
                {opportunity.name}
              </a>
            ) : (
              opportunity.name
            )}
          </h3>
          <p className="app-muted">{opportunity.funder}</p>
        </div>
        <div className="grant-cal-chips">
          <Badge tone={urgencyTone(entry.urgency)}>{urgencyLabel(entry.urgency)}</Badge>
          {eligibilityBadge(entry)}
          {entry.teamAdded ? <Badge tone="info">Your team added</Badge> : null}
        </div>
      </div>

      <dl className="grant-cal-facts">
        {opportunity.closesOn ? (
          <div>
            <dt>Closes</dt>
            <dd>
              {opportunity.closesOn}
              {entry.daysUntilClose !== null && entry.daysUntilClose >= 0
                ? ` (${entry.daysUntilClose} ${entry.daysUntilClose === 1 ? "day" : "days"})`
                : ""}
            </dd>
          </div>
        ) : null}
        {opportunity.opensOn ? (
          <div>
            <dt>Opens</dt>
            <dd>{opportunity.opensOn}</dd>
          </div>
        ) : null}
        {amount ? (
          <div>
            <dt>Typical award</dt>
            <dd>{amount}</dd>
          </div>
        ) : null}
        {entry.watcherCount > 0 ? (
          <div>
            <dt>Watching</dt>
            <dd>
              {entry.watcherCount} on your team
            </dd>
          </div>
        ) : null}
      </dl>

      {blockingReasons.length > 0 ? (
        <ul className="grant-cal-reasons">
          {blockingReasons.map((reason) => (
            <li key={`${reason.rule}-${reason.detail}`}>{reason.detail}</li>
          ))}
        </ul>
      ) : null}
      {unknownReasons.length > 0 ? (
        <ul className="grant-cal-reasons is-unknown">
          {unknownReasons.map((reason) => (
            <li key={`${reason.rule}-${reason.detail}`}>{reason.detail}</li>
          ))}
        </ul>
      ) : null}
      {opportunity.notes ? <p className="grant-cal-notes">{opportunity.notes}</p> : null}

      <div className="grant-cal-actions">
        <Button
          variant={entry.watching ? "primary" : "secondary"}
          type="button"
          onClick={onToggleWatch}
          disabled={busy}
          aria-pressed={entry.watching}
        >
          {busy ? "Saving…" : entry.watching ? "Watching — alerts on" : "Watch this grant"}
        </Button>
        {canManage && entry.teamAdded ? (
          <Button variant="ghost" type="button" onClick={onRemove} disabled={busy}>
            Remove
          </Button>
        ) : null}
      </div>
    </li>
  );
}

function EligibilityFactsForm({
  titleI,
  nonprofit501c3,
  busy,
  onSave,
}: {
  titleI: boolean | null;
  nonprofit501c3: boolean | null;
  busy: boolean;
  onSave: (facts: { titleI: string; nonprofit501c3: string }) => void | Promise<void>;
}) {
  const toValue = (flag: boolean | null) => (flag === null ? "unknown" : String(flag));
  const [titleIValue, setTitleIValue] = useState(toValue(titleI));
  const [nonprofitValue, setNonprofitValue] = useState(toValue(nonprofit501c3));

  return (
    <form
      className="grant-cal-facts-form"
      onSubmit={(event: FormEvent) => {
        event.preventDefault();
        void onSave({ titleI: titleIValue, nonprofit501c3: nonprofitValue });
      }}
    >
      <label>
        <span>Is your school Title I?</span>
        <select value={titleIValue} onChange={(event) => setTitleIValue(event.target.value)}>
          <option value="unknown">Not recorded</option>
          <option value="true">Yes</option>
          <option value="false">No</option>
        </select>
      </label>
      <label>
        <span>Does your team hold its own 501(c)(3)?</span>
        <select value={nonprofitValue} onChange={(event) => setNonprofitValue(event.target.value)}>
          <option value="unknown">Not recorded</option>
          <option value="true">Yes</option>
          <option value="false">No</option>
        </select>
      </label>
      <Button variant="primary" type="submit" disabled={busy}>
        {busy ? "Saving…" : "Save eligibility facts"}
      </Button>
    </form>
  );
}

function AddOpportunityForm({
  busy,
  onSubmit,
}: {
  busy: boolean;
  onSubmit: (fields: {
    name: string;
    funder: string;
    url: string;
    opensOn: string;
    closesOn: string;
    typicalAmountUsd: string;
    notes: string;
  }) => void | Promise<void>;
}) {
  const [fields, setFields] = useState({
    name: "",
    funder: "",
    url: "",
    opensOn: "",
    closesOn: "",
    typicalAmountUsd: "",
    notes: "",
  });
  const set = (key: keyof typeof fields) => (event: { target: { value: string } }) =>
    setFields((current) => ({ ...current, [key]: event.target.value }));

  return (
    <form
      className="grant-cal-form"
      onSubmit={(event: FormEvent) => {
        event.preventDefault();
        void onSubmit(fields);
      }}
    >
      <label>
        <span>Grant name</span>
        <input required value={fields.name} onChange={set("name")} maxLength={200} />
      </label>
      <label>
        <span>Funder</span>
        <input required value={fields.funder} onChange={set("funder")} maxLength={200} />
      </label>
      <label>
        <span>Application URL</span>
        <input type="url" value={fields.url} onChange={set("url")} placeholder="https://" />
      </label>
      <label>
        <span>Opens</span>
        <input type="date" value={fields.opensOn} onChange={set("opensOn")} />
      </label>
      <label>
        <span>Closes</span>
        <input type="date" value={fields.closesOn} onChange={set("closesOn")} />
      </label>
      <label>
        <span>Typical award (USD)</span>
        <input
          type="number"
          min="0"
          step="1"
          value={fields.typicalAmountUsd}
          onChange={set("typicalAmountUsd")}
          placeholder="Leave blank if unknown"
        />
      </label>
      <label className="grant-cal-form-wide">
        <span>Notes</span>
        <textarea value={fields.notes} onChange={set("notes")} rows={3} maxLength={4000} />
      </label>
      <Button variant="primary" type="submit" disabled={busy}>
        {busy ? "Adding…" : "Add to calendar"}
      </Button>
    </form>
  );
}
