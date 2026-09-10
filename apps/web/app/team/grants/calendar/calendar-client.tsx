"use client";

// Grant calendar: upcoming deadlines, honest eligibility chips, and a per-member watch that
// turns into 30/14/3-day alerts. Deliberately a separate route from the grant WRITING
// workbench at /team/grants — finding a grant and writing one are different jobs on
// different days, and the calendar has to load without the writing view's AI machinery.

import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { Badge, EmptyState, PageHeader, Panel, Button } from "../../../../components/ui";
import type {
  GrantCalendarEntry,
  GrantCalendarView,
} from "../../../../lib/grants-calendar/compute-grants-calendar";
import { urgencyLabel } from "../../../../lib/grants-calendar/eligibility";
import type { DeadlineUrgency } from "../../../../lib/grants-calendar/types";
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

export default function GrantCalendarClient({ orgId: orgIdProp }: { orgId?: string }) {
  const [view, setView] = useState<GrantCalendarView | null>(null);
  const [loadFailure, setLoadFailure] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>("open");
  const [showAdd, setShowAdd] = useState(false);

  const orgParam = useCallback(() => {
    if (orgIdProp) return orgIdProp;
    if (typeof window === "undefined") return null;
    return new URLSearchParams(window.location.search).get("orgId");
  }, [orgIdProp]);

  const load = useCallback(async () => {
    setLoadFailure(null);
    const org = orgParam();
    const query = org ? `?orgId=${encodeURIComponent(org)}` : "";
    try {
      const response = await fetch(`/api/grants-calendar${query}`);
      const data = (await response.json()) as GrantCalendarView | { error?: string };
      if (!response.ok || !("status" in data)) {
        setLoadFailure(
          ("error" in data && data.error) ||
            (response.status === 401
              ? "Your session expired. Sign in again to open the grant calendar."
              : "Could not load the grant calendar."),
        );
        return;
      }
      setView(data);
    } catch {
      setLoadFailure(
        "Could not reach the grant calendar. Check your connection and try again — no deadline is ever guessed offline.",
      );
    }
  }, [orgParam]);

  useEffect(() => {
    void load();
  }, [load]);

  const live = view?.status === "live" ? view : null;

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
        });
        const data = (await response.json()) as GrantCalendarView | { error?: string };
        if (!response.ok || !("status" in data)) {
          setError(("error" in data && data.error) || "That change did not save.");
          return;
        }
        setView(data);
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
      default:
        return live.entries;
    }
  }, [live, filter]);

  if (loadFailure) {
    return (
      <main className="module-page grant-cal-page content">
        <PageHeader
          breadcrumbs="Business / Grants / Calendar"
          title="Grant calendar"
          description={loadFailure}
        />
        <EmptyState
          soft
          badge="Retry"
          title="Grant calendar unavailable"
          description="Deadlines come from recorded calendar rows only — nothing is estimated while the calendar is offline."
        >
          <Button variant="primary" type="button" onClick={() => void load()}>
            Try again
          </Button>
        </EmptyState>
      </main>
    );
  }

  if (!view) {
    return (
      <main className="module-page grant-cal-page content">
        <PageHeader breadcrumbs="Business / Grants / Calendar" title="Grant calendar" />
        <EmptyState soft title="Opening the grant calendar…" aria-busy />
      </main>
    );
  }

  if (view.status === "setup_required") {
    return (
      <main className="module-page grant-cal-page content soft-gate">
        <PageHeader
          breadcrumbs="Business / Grants / Calendar"
          title="Grant calendar"
          description={view.message}
        />
        <EmptyState soft badge="Setup required" badgeTone="setup" title="Choose your team">
          {view.steps[0] ? (
            <Button as="a" variant="primary" href={view.steps[0].href}>
              {view.steps[0].label}
            </Button>
          ) : null}
        </EmptyState>
      </main>
    );
  }

  return (
    <main className="module-page grant-cal-page content">
      <PageHeader
        breadcrumbs="Business / Grants / Calendar"
        title="Grant calendar"
        description={`${live!.platformCount} maintained ${
          live!.platformCount === 1 ? "grant" : "grants"
        }${live!.teamCount > 0 ? ` plus ${live!.teamCount} your team added` : ""}. Watch one and we email you 30, 14, and 3 days before it closes.`}
      >
        <Button as="a" variant="ghost" href={`/team/grants?orgId=${encodeURIComponent(live!.orgId)}`}>
          Grant writing
        </Button>
      </PageHeader>

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

      {live!.profileGaps.length > 0 ? (
        <Panel className="grant-cal-gaps">
          <h2>Why some grants say “eligibility unknown”</h2>
          <p className="app-muted">
            We will not guess. Record these and the chips below turn into real answers:
          </p>
          <ul>
            {live!.profileGaps.map((gap) => (
              <li key={gap}>{gap}</li>
            ))}
          </ul>
          {live!.canManage ? (
            <EligibilityFactsForm
              titleI={live!.profile.titleI}
              nonprofit501c3={live!.profile.nonprofit501c3}
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
            live!.entries.length === 0
              ? "No grants on the calendar yet"
              : "Nothing matches this filter"
          }
          description={
            live!.entries.length === 0
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
              canManage={live!.canManage}
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

      {live!.canManage ? (
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
        <button
          type="button"
          className={`app-button${entry.watching ? "" : " ghost"}`}
          onClick={onToggleWatch}
          disabled={busy}
          aria-pressed={entry.watching}
        >
          {busy ? "Saving…" : entry.watching ? "Watching — alerts on" : "Watch this grant"}
        </button>
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
