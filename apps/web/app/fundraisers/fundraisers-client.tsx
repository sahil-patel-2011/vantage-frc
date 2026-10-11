"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { BusinessRelated } from "../../components/business-related";
import { OfflineBanner } from "../../components/offline-banner";
import { EmptyState, Button, useConfirm } from "../../components/ui";
import { FUNDRAISERS_RELATED_INCLUDE } from "../../lib/business/business-related";
import { fundraisersNextActions } from "../../lib/business/fundraisers-next-actions";
import { FEATURE_API_TIMEOUT_MS, persistOrgIdInUrl } from "../../lib/nav/resolve-org";
import { getFeatureSnapshot, putFeatureSnapshot } from "../../lib/offline/feature-cache";
import {
  FUNDRAISER_TYPE_LABEL,
  FUNDRAISER_TYPES,
  attainmentPct,
  hasFundraiserGoalProgress,
  type FundraiserStatus,
  type FundraiserType,
} from "../../lib/fundraisers";
import { classifyLoadFailure, loadFailureCopy } from "../../lib/ui/load-failure";
import { FINANCE_MANAGER_REQUIRED } from "../../lib/finance/finance-managers";
import "./fundraisers.css";
import { mentionsWaitlist, withWaitlistLink } from "../../components/waitlist-link";

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
      /** Finance manager (0714): the owner, or someone the owner chose. */
      canManageFinances?: boolean;
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

function isFundraisersView(value: unknown): value is View {
  if (!value || typeof value !== "object") return false;
  const status = (value as { status?: unknown }).status;
  return status === "setup_required" || status === "ready";
}

function fundraisersCacheOrg(data: View, orgHint: string): string {
  switch (data.status) {
    case "ready":
      return data.context.orgId.trim() || orgHint;
    case "setup_required":
      return data.orgId?.trim() || orgHint;
    default: {
      data satisfies never;
      return orgHint;
    }
  }
}

async function persistFundraisersSnapshot(orgHint: string, seasonHint: string, data: View): Promise<void> {
  const cacheOrg = fundraisersCacheOrg(data, orgHint);
  if (!cacheOrg) return;
  const seasonKey = data.status === "ready" ? String(data.seasonYear) : seasonHint;
  try {
    await putFeatureSnapshot("fundraisers", cacheOrg, data, seasonHint || seasonKey);
    if (!orgHint) await putFeatureSnapshot("fundraisers", "_", data, seasonHint || seasonKey);
  } catch {
    // Live Fundraisers already painted; IndexedDB is best-effort.
  }
}

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
            <a className="edc-next-action" href={action.href}>
              <strong>{action.label}</strong>
              <span>{action.detail}</span>
            </a>
          </li>
        ))}
      </ol>
    </section>
  );
}

export default function FundraisersClient({ orgId }: { orgId: string | null }) {
  const seasonYear = new Date().getFullYear();
  const [view, setView] = useState<View | null>(null);
  const confirm = useConfirm();
  // The deposit amount is typed in the row, not in the browser's prompt box.
  const [proceeds, setProceeds] = useState<{ id: string; amount: string } | null>(null);
  const [message, setMessage] = useState("");
  // Kept so an expired session offers sign-in instead of a spinner that never resolves.
  const [loadError, setLoadError] = useState("");
  const [errorStatus, setErrorStatus] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [fromCache, setFromCache] = useState(false);
  const [cachedAt, setCachedAt] = useState<string | null>(null);
  const [form, setForm] = useState({
    name: "",
    type: "car_wash",
    eventDate: todayIso(),
    goalUsd: "",
    location: "",
    notes: "",
  });
  const viewRef = useRef<View | null>(null);
  viewRef.current = view;

  const load = useCallback(() => {
    void (async () => {
      const orgHint = orgId?.trim() ?? "";
      const seasonHint = String(seasonYear);
      let hadCache = Boolean(viewRef.current);
      try {
        const cached = await getFeatureSnapshot<View>("fundraisers", orgHint || "_", seasonHint);
        if (!viewRef.current && cached?.data && isFundraisersView(cached.data)) {
          setView(cached.data);
          setFromCache(true);
          setCachedAt(cached.cachedAt);
          hadCache = true;
        }
      } catch {
        // IndexedDB missing or blocked; live fetch still runs.
      }
      setLoadError("");
      setErrorStatus(null);
      try {
        const response = await fetch(
          `/api/fundraisers?seasonYear=${seasonYear}${orgId ? `&orgId=${orgId}` : ""}`,
          { cache: "no-store", signal: AbortSignal.timeout(FEATURE_API_TIMEOUT_MS) },
        );
        const data = (await response.json()) as View & { error?: string };
        if (!response.ok || !isFundraisersView(data)) {
          if (hadCache || viewRef.current) {
            setFromCache(true);
            setMessage("Could not refresh Fundraisers. Showing the last copy on this device.");
            setLoadError("");
            setErrorStatus(null);
          } else {
            const detail = "error" in data && data.error ? data.error : "Failed to load fundraisers";
            setMessage(detail);
            setLoadError(detail);
            setErrorStatus(response.status);
          }
          return;
        }
        setView(data);
        setFromCache(false);
        setCachedAt(null);
        if (data.status === "ready" && data.context.orgId) persistOrgIdInUrl(data.context.orgId);
        await persistFundraisersSnapshot(orgHint, seasonHint, data);
      } catch {
        if (hadCache || viewRef.current) {
          setFromCache(true);
          setMessage("Could not refresh Fundraisers. Showing the last copy on this device.");
          setLoadError("");
        } else {
          setLoadError("Failed to load fundraisers");
          setErrorStatus(null);
        }
      }
    })();
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

  async function recordProceeds(id: string, amount: string) {
    const amountUsd = Number(amount);
    if (!Number.isFinite(amountUsd) || amountUsd <= 0) return;
    await post({ action: "record_proceeds", id, amountUsd }, "Proceeds recorded and posted to finance.");
    setProceeds(null);
  }

  async function cancelEvent(id: string, name: string) {
    const ok = await confirm({
      title: "Cancel this fundraiser?",
      body: `“${name}” is marked cancelled, and any proceeds recorded for it leave the team ledger.`,
      confirmLabel: "Cancel fundraiser",
      cancelLabel: "Keep it",
      tone: "destructive",
    });
    if (ok) await post({ action: "set_status", id, status: "cancelled" }, "Cancelled.");
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
    const offerWaitlist = !setupOrg && mentionsWaitlist(view.message);
    const nextActions = fundraisersNextActions({ orgId: setupOrg, eventCount: 0 });
    return (
      <main className="module-page fr-page">
        <header className="app-page-header">
          <div>
            <span className="breadcrumbs">Business / Fundraisers</span>
            <h1>Fundraisers</h1>
            <p className="app-muted">
              {offerWaitlist
                ? withWaitlistLink(view.message)
                : "Team-run events for this team. Proceeds post to finance once you record them."}
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
        <OfflineBanner feature="Fundraisers" fromCache={fromCache} cachedAt={cachedAt} />
        <EmptyState
          soft
          badge="Needs setup"
          badgeTone="setup"
          title="Choose your team"
          description={offerWaitlist ? withWaitlistLink(view.message) : view.message}
          className={offerWaitlist ? "fr-setup" : undefined}
        >
          {offerWaitlist ? (
            <div className="fr-setup-actions">
              <Button as="a" variant="primary" href="/workspace">
                Choose your team
              </Button>
              <a className="fr-setup-waitlist" href="/#waitlist">
                Join the waitlist
              </a>
            </div>
          ) : nextActions[0] ? (
            <Button as="a" variant="primary" href={nextActions[0].href}>
              {nextActions[0].label}
            </Button>
          ) : null}
        </EmptyState>
      </main>
    );
  }

  // Proceeds are money: only finance managers record them (0714). Planning an
  // event is not money, so every member except a view-only one can do that.
  const canManageMoney = view.canManageFinances === true;
  const canPlan = view.context.role !== "viewer";
  const showProgress = hasFundraiserGoalProgress(view.summary);
  const attainment =
    view.summary.attainment ??
    (view.summary.totalGoal > 0
      ? Math.min(100, Math.round((view.summary.totalRaised / view.summary.totalGoal) * 100))
      : null);
  const nextActions = fundraisersNextActions({
    orgId: view.context.orgId,
    canManageMoney,
    canPlanEvents: canPlan,
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
      <OfflineBanner feature="Fundraisers" fromCache={fromCache} cachedAt={cachedAt} />

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
              role="progressbar"
              aria-label="Combined fundraiser goals"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={Math.min(100, Math.max(0, attainment))}
              aria-valuetext={`${attainment}% of combined fundraiser goals`}
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
          badge={canPlan ? "Get started" : "Empty"}
          badgeTone={canPlan ? "" : "setup"}
          title="No fundraisers planned yet"
          description={
            canPlan
              ? "Add a community event below. Proceeds stay at $0 until a finance manager records a real deposit."
              : "Team members plan events and finance managers record deposits. Sponsors, Grants, and Orders stay in the header."
          }
        />
      ) : null}

      <div className="fr-grid">
        {canPlan ? (
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
        ) : null}

        <section className="app-card soft-panel fr-connect">
          <span className="biz-overline">How it connects</span>
          <h2>Finance, sponsors, grants, orders</h2>
          <p>
            Recorded proceeds post to your team finance ledger as income (source: fundraiser), so season fundraising
            stays accurate automatically.
          </p>
          <p>
            {canManageMoney ? "You can record proceeds on active events." : FINANCE_MANAGER_REQUIRED}
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
                    {/* Changing the status of an event that raised money moves that money. */}
                    {STATUS_FLOW[e.status] && canPlan && (canManageMoney || e.proceedsUsd <= 0) ? (
                      <Button variant="secondary" size="sm" type="button" disabled={busy} onClick={() => void post( { action: "set_status", id: e.id, status: STATUS_FLOW[e.status] }, "Status updated.", ) }>
                        Mark {STATUS_FLOW[e.status]}
                      </Button>
                    ) : null}
                    {canManageMoney && e.status !== "cancelled" ? (
                      <Button
                        variant="secondary"
                        size="sm"
                        type="button"
                        disabled={busy}
                        aria-expanded={proceeds?.id === e.id}
                        onClick={() => setProceeds(proceeds?.id === e.id ? null : { id: e.id, amount: "" })}
                      >
                        Record proceeds
                      </Button>
                    ) : null}
                    {e.status !== "completed" && e.status !== "cancelled" && canPlan && (canManageMoney || e.proceedsUsd <= 0) ? (
                      <Button variant="secondary" size="sm" type="button" disabled={busy} onClick={() => void cancelEvent(e.id, e.name)}>
                        Cancel event
                      </Button>
                    ) : null}
                  </div>
                  {proceeds?.id === e.id ? (
                    <form
                      className="fr-proceeds-form"
                      onSubmit={(event) => {
                        event.preventDefault();
                        void recordProceeds(e.id, proceeds.amount);
                      }}
                    >
                      <label className="inline-field-label">
                        Amount deposited ($)
                        <input
                          autoFocus
                          type="number"
                          inputMode="decimal"
                          min="0.01"
                          step="0.01"
                          value={proceeds.amount}
                          onChange={(event) => setProceeds({ id: e.id, amount: event.target.value })}
                          onKeyDown={(event) => {
                            if (event.key === "Escape") setProceeds(null);
                          }}
                        />
                      </label>
                      <Button variant="primary" size="sm" type="submit" disabled={busy || !(Number(proceeds.amount) > 0)}>
                        Record deposit
                      </Button>
                      <Button variant="secondary" size="sm" type="button" onClick={() => setProceeds(null)}>
                        Cancel
                      </Button>
                    </form>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}
    </main>
  );
}
