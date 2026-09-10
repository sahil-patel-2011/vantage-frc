"use client";

import { useCallback, useEffect, useState } from "react";
import { BusinessRelated } from "../../components/business-related";
import { EmptyState, Button } from "../../components/ui";
import { FUNDRAISERS_RELATED_INCLUDE } from "../../lib/business/business-related";
import { fundraisersNextActions } from "../../lib/business/fundraisers-next-actions";
import {
  FUNDRAISER_TYPE_LABEL,
  FUNDRAISER_TYPES,
  attainmentPct,
  hasFundraiserGoalProgress,
  type FundraiserStatus,
  type FundraiserType,
} from "../../lib/fundraisers";
import { classifyLoadFailure, loadFailureCopy } from "../../lib/ui/load-failure";
import "./fundraisers.css";

type FundraiserEvent = {
  id: string;
  seasonYear: number;
  name: string;
  type: FundraiserType;
  eventDate: string;
  goalUsd: number | null;
  proceedsUsd: number;
  status: FundraiserStatus;
  location: string;
  notes: string;
  byName: string | null;
};

type View =
  | { status: "setup_required"; message: string; orgId?: string | null }
  | {
      status: "ready";
      context: { orgId: string; orgName?: string; role: string };
      seasonYear: number;
      events: FundraiserEvent[];
      summary: {
        totalRaised: number;
        totalGoal: number;
        attainment: number | null;
        planned: number;
        active: number;
        completed: number;
      };
    };

const STATUS_FLOW: Record<FundraiserStatus, FundraiserStatus | null> = {
  planned: "active",
  active: "completed",
  completed: null,
  cancelled: null,
};

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function moneyUsd(value: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(value);
}

function FundraisersNextActions({
  actions,
}: {
  actions: ReturnType<typeof fundraisersNextActions>;
}) {
  if (!actions.length) return null;
  return (
    <section className="app-card soft-panel edc-next-actions fr-next-actions" aria-label="Next actions">
      <header>
        <span className="biz-overline">Next actions</span>
        <h2>Plan events and record real deposits</h2>
        <p>Raised totals stay empty until someone logs proceeds.</p>
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

export default function FundraisersClient({ orgId }: { orgId: string | null }) {
  const seasonYear = new Date().getFullYear();
  const [view, setView] = useState<View | null>(null);
  const [message, setMessage] = useState("");
  // Kept so an expired session offers sign-in instead of a spinner that never resolves.
  const [loadError, setLoadError] = useState("");
  const [errorStatus, setErrorStatus] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({
    name: "",
    type: "car_wash",
    eventDate: todayIso(),
    goalUsd: "",
    location: "",
    notes: "",
  });

  const load = useCallback(async () => {
    setLoadError("");
    setErrorStatus(null);
    const response = await fetch(
      `/api/fundraisers?seasonYear=${seasonYear}${orgId ? `&orgId=${orgId}` : ""}`,
    );
    const data = (await response.json()) as View & { error?: string };
    if (!response.ok) {
      setMessage(data.error ?? "Failed to load fundraisers");
      setLoadError(data.error ?? "Failed to load fundraisers");
      setErrorStatus(response.status);
      return;
    }
    setView(data);
  }, [orgId, seasonYear]);

  useEffect(() => {
    void load();
  }, [load]);

  async function post(body: Record<string, unknown>, okMessage: string) {
    if (view?.status !== "ready") return;
    setBusy(true);
    try {
      const response = await fetch("/api/fundraisers", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ orgId: view.context.orgId, ...body }),
      });
      const data = await response.json();
      setMessage(response.ok ? okMessage : (data.error as string));
      if (response.ok) await load();
    } finally {
      setBusy(false);
    }
  }

  async function addEvent(event: React.FormEvent) {
    event.preventDefault();
    await post({ action: "create_event", seasonYear, ...form }, "Fundraiser added.");
    if (view?.status === "ready") {
      setForm({ name: "", type: "car_wash", eventDate: todayIso(), goalUsd: "", location: "", notes: "" });
    }
  }

  async function recordProceeds(id: string) {
    const amount = window.prompt("How much did you collect (deposit amount, $)?");
    if (!amount) return;
    await post(
      { action: "record_proceeds", id, amountUsd: Number(amount) },
      "Proceeds recorded and posted to finance.",
    );
  }

  if (!view) {
    // Retry cannot fix an expired session, so the failure decides its own action.
    const failure = loadError
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
      <main className="module-page fr-page">
        <header className="app-page-header">
          <div>
            <span className="breadcrumbs">Business / Fundraisers</span>
            <h1>Fundraisers</h1>
          </div>
        </header>
        <EmptyState
          soft
          title={failure ? failure.title : "Loading fundraisers…"}
          description={failure ? failure.description : "Opening this season’s community events."}
          aria-busy={failure ? undefined : true}
        >
          {failure?.primary ? (
            <Button as="a" variant="primary" href={failure.primary.href}>
              {failure.primary.label}
            </Button>
          ) : null}
          {failure?.showRetry ? (
            <Button variant="secondary" type="button" onClick={() => void load()}>
              Retry
            </Button>
          ) : null}
        </EmptyState>
      </main>
    );
  }

  if (view.status === "setup_required") {
    const setupOrg = view.orgId ?? orgId;
    const nextActions = fundraisersNextActions({ orgId: setupOrg, eventCount: 0 });
    return (
      <main className="module-page fr-page">
        <header className="app-page-header">
          <div>
            <span className="breadcrumbs">Business / Fundraisers</span>
            <h1>Fundraisers</h1>
            <p className="app-muted">
              Team-run events for this team. Proceeds post to finance once you record them.
            </p>
          </div>
        </header>
        {setupOrg ? (
          <BusinessRelated
            orgId={setupOrg}
            active="fundraisers"
            include={FUNDRAISERS_RELATED_INCLUDE}
            ariaLabel="Related fundraising tools"
          />
        ) : null}
        <EmptyState soft badge="Setup required" badgeTone="setup" title={view.message}>
          {nextActions[0] ? (
            <Button as="a" variant="primary" href={nextActions[0].href}>
              {nextActions[0].label}
            </Button>
          ) : null}
        </EmptyState>
      </main>
    );
  }

  const canManageMoney = view.context.role === "owner" || view.context.role === "admin";
  const showProgress = hasFundraiserGoalProgress(view.summary);
  const attainment =
    view.summary.attainment ??
    (view.summary.totalGoal > 0
      ? Math.min(100, Math.round((view.summary.totalRaised / view.summary.totalGoal) * 100))
      : null);
  const nextActions = fundraisersNextActions({
    orgId: view.context.orgId,
    canManageMoney,
    eventCount: view.events.length,
    plannedCount: view.summary.planned,
    activeCount: view.summary.active,
    totalGoalUsd: view.summary.totalGoal,
    totalRaisedUsd: view.summary.totalRaised,
  });

  return (
    <main className="module-page fr-page">
      <header className="app-page-header">
        <div>
          <span className="breadcrumbs">Business / Fundraisers</span>
          <h1>Fundraiser events — {seasonYear}</h1>
          <p className="app-muted">
            Community campaigns for {view.context.orgName ?? "your team"}. Goal bars use recorded goals and deposits
            only.
          </p>
        </div>
      </header>

      <BusinessRelated
        orgId={view.context.orgId}
        active="fundraisers"
        include={FUNDRAISERS_RELATED_INCLUDE}
        ariaLabel="Related fundraising tools"
      />

      {message ? (
        <p className="fr-status" role="status">
          {message}
        </p>
      ) : null}

      <FundraisersNextActions actions={nextActions} />

      {showProgress ? (
        <section className="app-card soft-panel fr-progress" aria-label="Fundraiser goal progress">
          <header className="biz-card-head">
            <div>
              <span className="biz-overline">Season events</span>
              <h2>Goal progress from recorded data</h2>
            </div>
            <span className={`biz-badge ${attainment != null && attainment >= 100 ? "good" : attainment != null && attainment >= 50 ? "blue" : "neutral"}`}>
              {attainment != null ? `${attainment}% of goals` : "No combined goal"}
            </span>
          </header>
          <div className="soft-snapshot-grid fr-stats">
            <div>
              <strong className="accent">{moneyUsd(view.summary.totalRaised)}</strong>
              <span>recorded proceeds</span>
            </div>
            <div>
              <strong>{view.summary.totalGoal > 0 ? moneyUsd(view.summary.totalGoal) : "—"}</strong>
              <span>combined event goals</span>
            </div>
            <div>
              <strong>
                {view.summary.planned} / {view.summary.active} / {view.summary.completed}
              </strong>
              <span>planned / active / done</span>
            </div>
          </div>
          {view.summary.totalGoal > 0 && attainment != null ? (
            <div
              className="soft-track fr-track"
              aria-label={`${attainment}% of combined fundraiser goals`}
            >
              <i style={{ width: `${Math.min(100, Math.max(0, attainment))}%` }} />
            </div>
          ) : (
            <p className="app-muted fr-progress-note">
              Progress bar appears after you set at least one event goal. Raised $ only counts deposits you logged.
            </p>
          )}
        </section>
      ) : null}

      {!view.events.length ? (
        <EmptyState
          soft
          badge={canManageMoney ? "Get started" : "Empty"}
          badgeTone={canManageMoney ? "" : "setup"}
          title="No fundraisers planned yet"
          description={
            canManageMoney
              ? "Add a community event below. Proceeds stay at $0 until an owner/admin records a real deposit."
              : "A finance lead plans events and records deposits. Sponsors, Grants, and Orders stay in the header."
          }
        />
      ) : null}

      <div className="fr-grid">
        <form className="app-card soft-panel fr-form" onSubmit={addEvent}>
          <span className="biz-overline">Plan a fundraiser</span>
          <h2>Add a community event</h2>
          <label>
            Name
            <input
              required
              value={form.name}
              disabled={busy}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="Spring car wash"
            />
          </label>
          <div className="fr-fields">
            <label>
              Type
              <select
                value={form.type}
                disabled={busy}
                onChange={(e) => setForm({ ...form, type: e.target.value })}
              >
                {FUNDRAISER_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {FUNDRAISER_TYPE_LABEL[t]}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Date
              <input
                type="date"
                value={form.eventDate}
                disabled={busy}
                onChange={(e) => setForm({ ...form, eventDate: e.target.value })}
              />
            </label>
          </div>
          <div className="fr-fields">
            <label>
              Goal ($)
              <input
                type="number"
                min="0"
                step="0.01"
                value={form.goalUsd}
                disabled={busy}
                onChange={(e) => setForm({ ...form, goalUsd: e.target.value })}
                placeholder="Optional"
              />
            </label>
            <label>
              Location
              <input
                value={form.location}
                disabled={busy}
                onChange={(e) => setForm({ ...form, location: e.target.value })}
              />
            </label>
          </div>
          <label>
            Notes
            <input
              value={form.notes}
              disabled={busy}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
            />
          </label>
          <Button variant="primary" type="submit" disabled={busy}>
            Add fundraiser
          </Button>
        </form>

        <section className="app-card soft-panel fr-connect">
          <span className="biz-overline">How it connects</span>
          <h2>Finance, sponsors, grants, orders</h2>
          <p>
            Recorded proceeds post to your team finance ledger as income (source: fundraiser), so season fundraising
            stays accurate automatically.
          </p>
          <p>
            {canManageMoney
              ? "You can record proceeds on active events."
              : "Ask an owner/admin to record proceeds — money entries are admin-only."}
          </p>
          <BusinessRelated
            orgId={view.context.orgId}
            include={["sponsors", "grants", "orders", "finance-ai"]}
            ariaLabel="Fundraiser finance related links"
          />
        </section>
      </div>

      {view.events.length > 0 ? (
        <section className="app-card soft-panel fr-list" aria-label="Fundraiser events">
          <header className="biz-card-head">
            <div>
              <span className="biz-overline">This season</span>
              <h2>{view.events.length} fundraiser{view.events.length === 1 ? "" : "s"}</h2>
            </div>
          </header>
          <ul className="fr-event-list">
            {view.events.map((e) => {
              const pct = attainmentPct(e.proceedsUsd, e.goalUsd);
              return (
                <li key={e.id}>
                  <div>
                    <strong>
                      {e.name} · {FUNDRAISER_TYPE_LABEL[e.type]}
                    </strong>
                    <span>
                      {new Date(e.eventDate).toLocaleDateString()} · {e.status}
                      {e.location ? ` · ${e.location}` : ""}
                      {e.proceedsUsd > 0
                        ? ` · raised ${moneyUsd(e.proceedsUsd)}`
                        : " · no proceeds recorded"}
                      {e.goalUsd
                        ? ` of ${moneyUsd(e.goalUsd)}${pct != null ? ` (${pct}%)` : ""}`
                        : ""}
                    </span>
                    {e.goalUsd != null && e.goalUsd > 0 && pct != null ? (
                      <div className="soft-track fr-track-sm" aria-hidden>
                        <i style={{ width: `${Math.min(100, Math.max(0, pct))}%` }} />
                      </div>
                    ) : null}
                  </div>
                  <div className="fr-event-actions">
                    {STATUS_FLOW[e.status] ? (
                      <Button variant="secondary" size="sm" type="button" disabled={busy} onClick={() => void post( { action: "set_status", id: e.id, status: STATUS_FLOW[e.status] }, "Status updated.", ) }>
                        Mark {STATUS_FLOW[e.status]}
                      </Button>
                    ) : null}
                    {canManageMoney && e.status !== "cancelled" ? (
                      <Button variant="secondary" size="sm" type="button" disabled={busy} onClick={() => void recordProceeds(e.id)}>
                        Record $
                      </Button>
                    ) : null}
                    {e.status !== "completed" && e.status !== "cancelled" ? (
                      <Button variant="secondary" size="sm" type="button" disabled={busy} onClick={() => void post({ action: "set_status", id: e.id, status: "cancelled" }, "Cancelled.") }>
                        Cancel
                      </Button>
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}
    </main>
  );
}
