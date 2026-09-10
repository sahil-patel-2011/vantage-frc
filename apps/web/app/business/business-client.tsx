"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react";
import { BusinessRelated } from "../../components/business-related";
import PartnerPlacement from "../../components/partner-placement";
import { EmptyState, PageHeader, TabBar, ToolStrip } from "../../components/ui";
import { ActionMenu, type ActionSpec } from "../../components/ui/action-menu";
import { classifyLoadFailure, loadFailureCopy } from "../../lib/ui/load-failure";
import SustainabilityPanel from "./sustainability-panel";
import {
  GRANT_STATUSES,
  sponsorHealth,
  type BusinessPortalView,
  type BusinessView,
  type GrantApplication,
  type PurchaseRequest,
} from "../../lib/business-portal";
import { BUSINESS_GRANTS_RELATED_INCLUDE } from "../../lib/business/business-related";
import {
  businessDefaultTab,
  fundingModelFromFlags,
} from "../../lib/funding-profile";
import { describeBudgetLine, type BudgetLine, type BudgetVsActualView } from "../../lib/finance/budget-vs-actual";
import { SoftAccessDenied } from "../../components/hub-access-gate";
import {
  clientCanAccessHub,
  filterSponsorTabs,
  filterTabsByHubAccess,
  SPONSOR_TAB_IDS,
} from "../../lib/nav/hub-access-filter";
import {
  hubById,
  hubLegacyHref,
  hubNestedTabs,
  hubPrimaryTabs,
  hubWorkbenchId,
  isHubTab,
} from "../../lib/nav/hubs";
import { useClientAccessProfile } from "../../lib/nav/use-client-access";
import { FundraisingGlance } from "./fundraising-glance";
import { PartnerPlacementsPanel } from "./partner-placements-panel";
import { SponsorPipelinePanel } from "./sponsor-pipeline-panel";
import "../product-hub.css";
const OrdersClient = dynamic(() => import("../orders/orders-client"), { ssr: false });
const SeasonFinanceClient = dynamic(() => import("./season-finance-client"), { ssr: false });
const SponsorshipClient = dynamic(() => import("../sponsorship/sponsorship-client"), { ssr: false });

const BUSINESS_HUB = hubById("business");
const WORKBENCHES = hubPrimaryTabs(BUSINESS_HUB);

type Tab =
  | "overview"
  | "finance"
  | "budget"
  | "orders"
  | "sponsors"
  | "sponsorship"
  | "placements"
  | "grants"
  | "evidence";

const TABS: Array<{ id: Tab; label: string }> = [
  { id: "overview", label: "Overview" },
  { id: "finance", label: "Money" },
  { id: "budget", label: "Budget" },
  { id: "orders", label: "Orders" },
  { id: "sponsors", label: "Sponsors" },
  { id: "sponsorship", label: "Packages" },
  { id: "placements", label: "Partners" },
  { id: "grants", label: "Grants" },
  { id: "evidence", label: "Outreach" },
];

function isTab(value: string | null): value is Tab {
  return TABS.some((tab) => tab.id === value);
}

function readOrgIdFromUrl(): string | null {
  if (typeof window === "undefined") return null;
  return new URLSearchParams(window.location.search).get("orgId");
}

function readTabFromUrl(): Tab {
  if (typeof window === "undefined") return "overview";
  const tab = new URLSearchParams(window.location.search).get("tab");
  return isTab(tab) ? tab : "overview";
}

/** Nested tools that are not in-panel jump to their standalone page. */
function redirectMoreToolTab(): boolean {
  if (typeof window === "undefined") return false;
  const tab = new URLSearchParams(window.location.search).get("tab");
  if (!tab || isTab(tab) || !isHubTab(BUSINESS_HUB, tab)) return false;
  const nested = BUSINESS_HUB.tabs.find((entry) => entry.id === tab);
  if (!nested?.legacyHref) return false;
  window.location.replace(hubLegacyHref(nested, readOrgIdFromUrl()));
  return true;
}

function writeTabToUrl(tab: Tab) {
  if (typeof window === "undefined") return;
  const url = new URL(window.location.href);
  if (tab === "overview") url.searchParams.delete("tab");
  else url.searchParams.set("tab", tab);
  window.history.replaceState({}, "", `${url.pathname}${url.search}`);
}

function money(cents: number): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(cents / 100);
}

function dollars(cents: number): string {
  return (cents / 100).toFixed(2);
}


function percent(value: number, total: number): number {
  if (total <= 0) return 0;
  return Math.min(100, Math.max(0, Math.round((value / total) * 100)));
}

function statusLabel(value: string): string {
  return value.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function ToneBadge({ children, tone = "neutral" }: { children: ReactNode; tone?: "good" | "warn" | "danger" | "neutral" | "blue" }) {
  return <span className={`biz-badge ${tone}`}>{children}</span>;
}

function Field({ label, hint, children, wide = false }: { label: string; hint?: string; children: ReactNode; wide?: boolean }) {
  return (
    <label className={`biz-field${wide ? " wide" : ""}`}>
      <span>{label}</span>
      {children}
      {hint ? <small>{hint}</small> : null}
    </label>
  );
}

export default function BusinessClient() {
  const access = useClientAccessProfile();
  const [view, setView] = useState<BusinessPortalView | null>(null);
  const [tab, setTab] = useState<Tab>("overview");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  // Kept apart from mutation errors so an expired session offers sign-in, not a Retry that cannot work.
  const [loadFailure, setLoadFailure] = useState<{ status: number | null; message: string } | null>(null);
  const [notice, setNotice] = useState("");

  const selectTab = useCallback((next: Tab) => {
    setTab(next);
    writeTabToUrl(next);
  }, []);

  const load = useCallback(async (seasonOverride?: number) => {
    setError("");
    setLoadFailure(null);
    const params = new URLSearchParams(window.location.search);
    const query = new URLSearchParams();
    if (params.get("orgId")) query.set("orgId", params.get("orgId")!);
    if (seasonOverride) query.set("season", String(seasonOverride));
    try {
      const response = await fetch(`/api/business?${query.toString()}`);
      const data = (await response.json()) as BusinessPortalView | { error?: string };
      if (!response.ok || !("status" in data)) {
        setLoadFailure({
          status: response.status,
          message: ("error" in data && data.error) || "Could not load portal",
        });
        return;
      }
      setLoadFailure(null);
      setView(data);
    } catch (cause) {
      setLoadFailure({
        status: null,
        message: cause instanceof Error ? cause.message : "Could not load the business portal",
      });
    }
  }, []);

  useEffect(() => {
    if (redirectMoreToolTab()) return;
    setTab(readTabFromUrl());
    void load();
  }, [load]);

  const live = view?.status === "live" ? view : null;
  const sponsorsAllowed = live?.sponsorsAllowed ?? access.sponsorsAllowed;

  useEffect(() => {
    if (typeof window === "undefined" || !live) return;
    if (new URLSearchParams(window.location.search).get("tab")) return;
    const model = fundingModelFromFlags({
      schoolFunded: Boolean(live.schoolFunded),
      sponsorsAllowed: live.sponsorsAllowed !== false,
    });
    const next = businessDefaultTab(model);
    if (isTab(next) && next !== tab) {
      setTab(next);
      writeTabToUrl(next);
    }
  }, [live, tab]);
  const visibleWorkbenches = useMemo(
    () =>
      filterTabsByHubAccess(
        filterSponsorTabs(WORKBENCHES, sponsorsAllowed),
        access.hubAccess,
        "business",
      ),
    [access.hubAccess, sponsorsAllowed],
  );
  const workbenchId = hubWorkbenchId(BUSINESS_HUB, tab);
  /**
   * Tools *inside* the open workbench. `hubNestedTabs` leads with the workbench
   * root, which is already the selected chip in the row above — keeping it here
   * printed "Money"/"Sponsors" twice on the same screen. Drop it; the tab bar is
   * how you get back to the workbench's own view.
   */
  const visibleNested = useMemo(() => {
    const nested = hubNestedTabs(BUSINESS_HUB, workbenchId).filter(
      (entry) => entry.group === workbenchId,
    );
    if (nested.length === 0) return [];
    return filterTabsByHubAccess(
      filterSponsorTabs(nested, sponsorsAllowed),
      access.hubAccess,
      "business",
    );
  }, [sponsorsAllowed, access.hubAccess, workbenchId]);
  const hubDenied = access.ready && !clientCanAccessHub(access.hubAccess, "business");

  useEffect(() => {
    if (SPONSOR_TAB_IDS.has(tab) && sponsorsAllowed === false) {
      selectTab("overview");
      return;
    }
    if (!access.ready || !visibleWorkbenches.length) return;
    if (visibleWorkbenches.some((entry) => entry.id === tab || entry.id === workbenchId)) return;
    selectTab((visibleWorkbenches[0]?.id as Tab) ?? "overview");
  }, [access.ready, selectTab, sponsorsAllowed, tab, visibleWorkbenches, workbenchId]);

  const mutate = useCallback(async (payload: Record<string, unknown>): Promise<boolean> => {
    if (!live || busy) return false;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const response = await fetch("/api/business", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ orgId: live.orgId, seasonYear: live.seasonYear, ...payload }),
      });
      const data = (await response.json()) as BusinessPortalView | { error?: string };
      if (!response.ok || !("status" in data)) throw new Error("error" in data && data.error ? data.error : "Request failed");
      setView(data);
      setNotice("Saved. The whole team now sees the latest record.");
      return true;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Request failed");
      return false;
    } finally {
      setBusy(false);
    }
  }, [busy, live]);

  const submit = useCallback(async (
    event: FormEvent<HTMLFormElement>,
    action: string,
    dollarFields: string[] = [],
  ) => {
    event.preventDefault();
    const form = event.currentTarget;
    const payload = Object.fromEntries(new FormData(form).entries()) as Record<string, unknown>;
    for (const name of dollarFields) {
      const raw = Number(payload[`${name}Dollars`] ?? 0);
      payload[`${name}Cents`] = Number.isFinite(raw) ? Math.max(0, Math.round(raw * 100)) : 0;
      delete payload[`${name}Dollars`];
    }
    const saved = await mutate({ action, ...payload });
    if (saved && action !== "save-budget") form.reset();
  }, [mutate]);

  const research = useCallback(async () => {
    if (!live || busy) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const response = await fetch("/api/business/research", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ orgId: live.orgId }),
      });
      const data = (await response.json()) as { message?: string; error?: string };
      if (!response.ok) throw new Error(data.error ?? "Sponsor research failed");
      setNotice(data.message ?? "Sponsor research complete.");
      await load(live.seasonYear);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Sponsor research failed");
    } finally {
      setBusy(false);
    }
  }, [busy, live, load]);

  const orgId = live?.orgId;

  if (hubDenied) {
    return (
      <SoftAccessDenied
        breadcrumbs="Business"
        title="Business"
        heading="Business is not available"
        description="Your team admin limited which sections you can open. Ask an owner to update section access under Team → Security."
      />
    );
  }

  return (
    <main className="module-page business-page">
      <PageHeader
        breadcrumbs="Business"
        title="Business"
        description={
          live
            ? `Season finance, budget, purchases, sponsors, grants, and award evidence for ${live.teamNumber ? `FRC ${live.teamNumber}` : live.orgName} · ${live.seasonYear}.`
            : "Season finance, budget, purchases, sponsors, grants, and award evidence — one season source of truth."
        }
      >
        {live ? (
          <div className="biz-header-actions">
            <label className="biz-season">
              Season
              <select value={live.seasonYear} onChange={(event) => void load(Number(event.target.value))}>
                {live.seasons.map((season) => (
                  <option key={season} value={season}>
                    {season}
                  </option>
                ))}
              </select>
            </label>
            <ToneBadge tone={live.canManageFinance ? "blue" : "neutral"}>
              {live.canManageFinance ? "Finance lead" : "Team member"}
            </ToneBadge>
          </div>
        ) : null}
      </PageHeader>

      <TabBar
        aria-label="Business sections"
        value={workbenchId}
        onChange={(id) => {
          if (isTab(id)) selectTab(id);
          else selectTab((hubWorkbenchId(BUSINESS_HUB, id) as Tab) || "overview");
        }}
        tabs={visibleWorkbenches.map((entry) => ({ id: entry.id, label: entry.label }))}
        className="product-hub-tabs"
      />
      {visibleNested.length > 0 ? (
        <ToolStrip
          aria-label={`Tools in ${BUSINESS_HUB.tabs.find((entry) => entry.id === workbenchId)?.label ?? "Business"}`}
          value={tab}
          onChange={(id) => {
            if (isTab(id)) {
              selectTab(id);
              return;
            }
            const nested = BUSINESS_HUB.tabs.find((entry) => entry.id === id);
            if (nested?.legacyHref) {
              window.location.assign(hubLegacyHref(nested, orgId ?? live?.orgId ?? null));
            }
          }}
          items={visibleNested.map((entry) => ({
            id: entry.id,
            label: entry.label,
            featured: entry.featured === true,
            // Tools this hub does not render inline are real links, so they go
            // straight to the page instead of bouncing off a redirect card.
            href:
              !isTab(entry.id) && entry.legacyHref
                ? hubLegacyHref(entry, orgId ?? live?.orgId ?? null)
                : undefined,
          }))}
        />
      ) : null}

      {/* Below the tab bar, not above it. A save error or a slow first load used
          to push Business's own navigation down the page — the one thing you
          need to still be where it was when something goes wrong. These belong
          with the panel they are talking about. */}
      {error ? (
        <div className="biz-alert danger" role="alert">
          <strong>Couldn’t complete that.</strong>
          <span>{error}</span>
          <button type="button" onClick={() => setError("")}>
            Dismiss
          </button>
        </div>
      ) : null}
      {notice ? (
        <div className="biz-alert success" role="status">
          <strong>Done.</strong>
          <span>{notice}</span>
          <button type="button" onClick={() => setNotice("")}>
            Dismiss
          </button>
        </div>
      ) : null}

      {!view ? (
        loadFailure ? (
          (() => {
            const copy = loadFailureCopy(
              classifyLoadFailure({
                status: loadFailure.status,
                message: loadFailure.message,
                online: typeof navigator === "undefined" ? true : navigator.onLine,
              }),
              {
                nextPath:
                  typeof window === "undefined"
                    ? null
                    : `${window.location.pathname}${window.location.search}`,
                message: loadFailure.message,
              },
            );
            return (
              <EmptyState soft title={copy.title} description={copy.description}>
                {copy.primary ? (
                  <a className="app-button" href={copy.primary.href}>
                    {copy.primary.label}
                  </a>
                ) : null}
                {copy.showRetry ? (
                  <button type="button" className="app-button secondary" onClick={() => void load()}>
                    Retry
                  </button>
                ) : null}
              </EmptyState>
            );
          })()
        ) : (
          <EmptyState soft title="Opening business…" description="Loading this season’s budget, orders, partners, grants, and evidence." aria-busy />
        )
      ) : null}

      {view?.status === "setup_required" ? (
        <EmptyState badge="Setup required" badgeTone="setup" title={view.message} description="Choose the organization for this team, then return here to start the season business plan.">
          <a className="app-button" href="/workspace">
            Choose workspace
          </a>
        </EmptyState>
      ) : null}

      {live ? (
        <>
          {tab === "overview" ? <Overview view={live} setTab={selectTab} /> : null}
          {tab === "finance" ? (
            <div className="product-hub-panel">
              <SeasonFinanceClient embedded orgId={live.orgId} seasonYear={live.seasonYear} />
            </div>
          ) : null}
          {tab === "budget" ? <Budget view={live} busy={busy} submit={submit} mutate={mutate} /> : null}
          {tab === "orders" ? (
            <div className="product-hub-panel">
              <OrdersClient embedded seasonYear={live.seasonYear} orgId={live.orgId} />
            </div>
          ) : null}
          {tab === "sponsors" ? (
            <SponsorPipelinePanel
              view={live}
              busy={busy}
              submit={submit}
              mutate={async (body) => { await mutate(body); }}
              research={research}
            />
          ) : null}
          {tab === "sponsorship" ? (
            <div className="product-hub-panel">
              <SponsorshipClient embedded />
            </div>
          ) : null}
          {tab === "placements" ? (
            <PartnerPlacementsPanel orgId={live.orgId} seasonYear={live.seasonYear} canManage={live.canManageFinance} />
          ) : null}
          {tab === "grants" ? <Grants view={live} busy={busy} submit={submit} mutate={mutate} /> : null}
          {tab === "evidence" ? <Evidence view={live} busy={busy} submit={submit} /> : null}
        </>
      ) : null}
    </main>
  );
}

function Overview({ view, setTab }: { view: BusinessView; setTab: (tab: Tab) => void }) {
  const available = view.budget.totalBudgetCents + view.budget.sponsorIncomeCents + view.budget.grantIncomeCents;
  const utilization = percent(view.budget.committedCents, available);
  const submitted = view.purchases.filter((purchase) => purchase.status === "submitted");
  const followUps = view.sponsors.filter((sponsor) => sponsorHealth(sponsor) !== "healthy");
  const grantDeadlines = view.grants.filter((grant) => grant.deadline && !["awarded", "declined"].includes(grant.status)).slice(0, 5);
  const reminders = view.sponsorReminders.slice(0, 5);
  const progress = view.fundraisingProgress;
  const pulse = view.ordersPulse ?? {
    pendingCount: 0,
    readyToBuyCount: 0,
    openTotalCents: 0,
    financeAiEnabled: false,
    aiHeadline: null,
    aiRecommendations: [] as string[],
  };
  const ordersHref = `/orders?orgId=${encodeURIComponent(view.orgId)}&season=${view.seasonYear}`;
  const businessOrdersHref = `/business?orgId=${encodeURIComponent(view.orgId)}&tab=orders`;
  const financeAiHref = `/ai?orgId=${encodeURIComponent(view.orgId)}&tab=finance`;
  const costsHref = `/costs?orgId=${encodeURIComponent(view.orgId)}&season=${view.seasonYear}`;
  return (
    <div className="biz-stack">
      {/* Early warning sits above the KPIs: a team on the death track should read that
          before it reads how much of this season's budget is committed. */}
      <SustainabilityPanel orgId={view.orgId} seasonYear={view.seasonYear} />
      <section className="biz-kpis" aria-label="Season funding summary">
        <Kpi label="Working funds" value={money(available)} detail={`${money(view.budget.totalBudgetCents)} base budget`} tone="blue" />
        <Kpi label="Committed" value={money(view.budget.committedCents)} detail={`${utilization}% of working funds`} tone={utilization > 90 ? "danger" : "neutral"} />
        <Kpi
          label="Raised vs goal"
          value={progress.goalCents > 0 ? `${progress.percentOfGoal}%` : "—"}
          detail={
            progress.goalCents > 0
              ? `${money(progress.actualCents)} of ${money(progress.goalCents)}`
              : progress.actualCents > 0
                ? `${money(progress.actualCents)} recorded · set a goal`
                : "Set a season goal."
          }
          tone={progress.goalCents > 0 && progress.percentOfGoal >= 100 ? "good" : "blue"}
        />
        <Kpi label="Grant awards" value={money(view.budget.grantIncomeCents)} detail={`${view.grants.length} applications tracked`} tone="good" />
        <Kpi label="Awaiting approval" value={money(view.budget.requestedCents)} detail={`${pulse.pendingCount} open orders`} tone={pulse.pendingCount ? "warn" : "neutral"} />
        <Kpi label="Ready to buy" value={String(pulse.readyToBuyCount)} detail={`${money(pulse.openTotalCents)} open`} tone={pulse.readyToBuyCount ? "warn" : "neutral"} />
      </section>

      {pulse.financeAiEnabled && pulse.aiHeadline ? (
        <section className="app-card soft-panel" aria-label="Finance assistant on open orders">
          <header className="biz-card-head">
            <div>
              <span className="biz-overline">Finance assistant</span>
              <h2>Open purchase requests</h2>
            </div>
            <a className="app-button secondary" href={ordersHref}>Open orders</a>
          </header>
          <p style={{ margin: "8px 0", fontWeight: 600 }}>{pulse.aiHeadline}</p>
          <ul style={{ margin: 0, paddingLeft: 18, display: "grid", gap: 6 }}>
            {pulse.aiRecommendations.slice(0, 4).map((rec) => (
              <li key={rec}>{rec}</li>
            ))}
          </ul>
          <small className="app-muted" style={{ display: "block", marginTop: 8 }}>
            Opt-in rule-based guidance from Season Costs — no card or bank data stored. Chat Finance-in-AI is under{" "}
            <a href={financeAiHref}>AI → Finance</a>.
          </small>
        </section>
      ) : null}

      <FundraisingGlance view={view} onOpenSponsors={() => setTab("sponsors")} />

      <section className="biz-grid two">
        <article className="app-card biz-finance-pulse">
          <header><div><span className="biz-overline">Financial pulse</span><h2>Know the number before saying yes.</h2></div><strong>{utilization}%</strong></header>
          <div className="biz-progress"><i style={{ width: `${utilization}%` }} /></div>
          <div className="biz-split-metrics">
            <div><span>Approved + ordered</span><strong>{money(view.budget.committedCents)}</strong></div>
            <div><span>Actually ordered</span><strong>{money(view.budget.spentCents)}</strong></div>
            <div><span>Fundraising actual</span><strong>{money(progress.actualCents)}</strong></div>
          </div>
          {/* Three same-weight buttons became one primary + one secondary + overflow. */}
          <ActionMenu
            label="Financial pulse"
            maxSecondary={1}
            actions={[
              { id: "finance", label: "Open season finance", intent: "primary", onClick: () => setTab("finance") },
              { id: "budget", label: "Open budget", onClick: () => setTab("budget") },
              { id: "orders", label: "Purchase orders", hint: "Approve, order, receive", href: businessOrdersHref },
            ]}
          />
        </article>
        <article className="app-card">
          <header className="biz-card-head"><div><span className="biz-overline">Attention queue</span><h2>What needs a human next</h2></div><span className="biz-count">{submitted.length + reminders.length + followUps.length + grantDeadlines.length}</span></header>
          <ul className="biz-action-list">
            {submitted.slice(0, 3).map((purchase) => <li key={purchase.id}><ToneBadge tone="warn">Purchase</ToneBadge><div><strong>{purchase.itemName}</strong><span>{money(purchase.totalCents)} requested by {purchase.requestedByName}</span></div><a href={`${ordersHref}&orderId=${encodeURIComponent(purchase.id)}`}>Review</a></li>)}
            {reminders.map((reminder) => (
              <li key={`${reminder.kind}-${reminder.sponsorId}`}>
                <ToneBadge tone={reminder.kind === "thank_you" ? "good" : reminder.kind === "renewal" ? "blue" : "danger"}>
                  {reminder.kind === "thank_you" ? "Thank-you" : reminder.kind === "renewal" ? "Renewal" : "Follow-up"}
                </ToneBadge>
                <div>
                  <strong>{reminder.sponsorName}</strong>
                  <span>{reminder.message} · due {reminder.dueOn}</span>
                </div>
                <button type="button" onClick={() => setTab("sponsors")}>Open</button>
              </li>
            ))}
            {followUps.slice(0, 3).map((sponsor) => <li key={sponsor.id}><ToneBadge tone={sponsorHealth(sponsor) === "due" ? "danger" : "warn"}>Sponsor</ToneBadge><div><strong>{sponsor.name}</strong><span>{sponsor.nextFollowUpOn ? `Follow-up ${sponsor.nextFollowUpOn}` : "Relationship needs a next step"}</span></div><button type="button" onClick={() => setTab("sponsors")}>Connect</button></li>)}
            {grantDeadlines.map((grant) => <li key={grant.id}><ToneBadge tone="blue">Grant</ToneBadge><div><strong>{grant.title}</strong><span>Due {grant.deadline}</span></div><button type="button" onClick={() => setTab("grants")}>Open</button></li>)}
            {!submitted.length && !reminders.length && !followUps.length && !grantDeadlines.length ? <li className="empty"><strong>Queue clear.</strong><span>Add a purchase, sponsor, or grant opportunity to start the operating rhythm.</span></li> : null}
          </ul>
        </article>
      </section>

      <section className="biz-grid three">
        <article className="app-card"><span className="biz-overline">Monthly spend</span><h2>Order rhythm</h2><MonthBars rows={view.budget.monthlySpend} /></article>
        <article className="app-card soft-panel"><span className="biz-overline">Relationship memory</span><h2>Built to survive graduation</h2><div className="biz-big-stat">{view.interactions.length}</div><p className="app-muted">Sponsor interactions logged with owners, dates, next steps, and follow-ups.</p><button className="app-button secondary" type="button" onClick={() => setTab("sponsors")}>Open sponsors</button></article>
        <article className="app-card soft-panel"><span className="biz-overline">Evidence locker</span><h2>Never write from memory again</h2><div className="biz-evidence-stats"><b>{view.awards.length}<small>awards</small></b><b>{view.impact.hours}<small>impact hours</small></b><b>{view.impact.peopleReached.toLocaleString()}<small>people reached</small></b></div><button className="app-button secondary" type="button" onClick={() => setTab("evidence")}>Open awards</button></article>
      </section>

      <section className="biz-grid two">
        <article className="app-card">
          <span className="biz-overline">Partner recognition</span>
          <h2>Sell placements without leaving Vantage.</h2>
          <p className="app-muted">Storefront packages, creative approval, and live recognition strips share this org—dashboard, pit, and this portal.</p>
          <button className="app-button secondary" type="button" onClick={() => setTab("placements")}>Open partners</button>
        </article>
        <article className="app-card soft-panel">
          <span className="biz-overline">Season spend + finance AI</span>
          <h2>Track spend, and choose what AI can read.</h2>
          <p className="app-muted">
            <a href={costsHref}>Season Costs</a> tracks event spend and a local rule-based assistant for open{" "}
            <a href={ordersHref}>purchase requests</a>. Chat tools that read redacted budgets require{" "}
            <a href={financeAiHref}>Finance-in-AI</a> under AI governance — never card or bank details.
          </p>
          {/* Finance-in-AI is the same label pointing at the same href three
              lines up, in this card's own sentence. One copy. */}
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            <a className="app-button secondary" href={costsHref}>Open Season Costs</a>
          </div>
        </article>
      </section>

      <PartnerPlacement orgId={view.orgId} surface="business_wall" title="Partners powering this team" />
    </div>
  );
}

function Kpi({ label, value, detail, tone }: { label: string; value: string; detail: string; tone: "blue" | "good" | "warn" | "danger" | "neutral" }) {
  return <article className={`biz-kpi ${tone}`}><span>{label}</span><strong>{value}</strong><small>{detail}</small></article>;
}

function MonthBars({ rows }: { rows: BusinessView["budget"]["monthlySpend"] }) {
  const max = Math.max(1, ...rows.map((row) => row.cents));
  if (!rows.length) return <p className="biz-empty-inline">Ordered purchases will appear here by month.</p>;
  return <div className="biz-month-bars">{rows.map((row) => <div key={row.month}><span>{row.month}</span><i><b style={{ width: `${Math.max(4, percent(row.cents, max))}%` }} /></i><strong>{money(row.cents)}</strong></div>)}</div>;
}

type Submit = (event: FormEvent<HTMLFormElement>, action: string, dollarFields?: string[]) => Promise<void>;
type Mutate = (payload: Record<string, unknown>) => Promise<boolean>;

function Budget({ view, busy, submit, mutate }: { view: BusinessView; busy: boolean; submit: Submit; mutate: Mutate }) {
  const categorySpend = useMemo(() => new Map(view.categories.map((category) => [category.id, view.purchases.filter((purchase) => purchase.categoryId === category.id && ["approved", "ordered", "received"].includes(purchase.status)).reduce((total, purchase) => total + purchase.totalCents, 0)])), [view.categories, view.purchases]);
  const financeAiHref = `/ai?tab=finance&orgId=${encodeURIComponent(view.orgId)}`;
  const [budgetLines, setBudgetLines] = useState<BudgetLine[]>([]);
  useEffect(() => {
    let cancelled = false;
    void fetch(
      `/api/finance/budget-vs-actual?orgId=${encodeURIComponent(view.orgId)}&seasonYear=${view.seasonYear}`,
    )
      .then(async (response) => {
        const data = (await response.json()) as BudgetVsActualView;
        if (cancelled) return;
        setBudgetLines(data.status === "ready" ? data.lines : []);
      })
      .catch(() => {
        if (!cancelled) setBudgetLines([]);
      });
    return () => {
      cancelled = true;
    };
  }, [view.orgId, view.seasonYear]);
  return <div className="biz-stack">
    <div className="biz-detail-link">
      <span>Need help reading the season budget against open purchase requests?</span>
      <a href={`/business?orgId=${encodeURIComponent(view.orgId)}&tab=finance`}>Season finance →</a>
      <a href={financeAiHref}>Finance AI →</a>
      <a href={`/costs?orgId=${encodeURIComponent(view.orgId)}`}>Season Costs →</a>
    </div>
    <section className="biz-grid two">
      <article className="app-card">
        <header className="biz-card-head"><div><span className="biz-overline">Season guardrails</span><h2>Set the budget once. Compare every decision to it.</h2><p className="app-muted" style={{ margin: "8px 0 0", fontSize: 12 }}>For event-by-event spend tracking, use <a href={`/costs?orgId=${encodeURIComponent(view.orgId)}`}>Season Costs</a>. Chat guidance lives under <a href={financeAiHref}>Finance AI</a>.</p></div>{view.canManageFinance ? <ToneBadge tone="blue">Lead controls</ToneBadge> : <ToneBadge>Read only</ToneBadge>}</header>
        <form className="biz-form-grid" onSubmit={(event) => void submit(event, "save-budget", ["totalBudget", "fundraisingGoal"])}>
          <Field label="Operating budget"><input name="totalBudgetDollars" type="number" min="0" step="0.01" defaultValue={dollars(view.budget.totalBudgetCents)} disabled={!view.canManageFinance} /></Field>
          <Field label="Fundraising goal"><input name="fundraisingGoalDollars" type="number" min="0" step="0.01" defaultValue={dollars(view.budget.fundraisingGoalCents)} disabled={!view.canManageFinance} /></Field>
          <Field label="Finance notes" wide><textarea name="notes" rows={3} placeholder="Cash reserves, travel assumptions, board constraints…" disabled={!view.canManageFinance} /></Field>
          <button className="app-button" disabled={busy || !view.canManageFinance}>Save season guardrails</button>
        </form>
        {view.canManageFinance ? <form className="biz-inline-form" onSubmit={(event) => void submit(event, "add-category", ["allocated"])}><input name="name" placeholder="Category (Robot, Travel, Outreach…)" required /><input name="allocatedDollars" type="number" min="0" step="0.01" placeholder="Allocation" required /><button disabled={busy}>Add / update category</button></form> : null}
      </article>
      <article className="app-card biz-order-form">
        <span className="biz-overline">Student purchasing</span><h2>Request an Amazon order without losing the why.</h2>
        <form className="biz-form-grid" onSubmit={(event) => void submit(event, "submit-purchase", ["unitPrice", "shipping"])}>
          <Field label="Item" wide><input name="itemName" required placeholder="2 × 1 aluminum tube" /></Field>
          <Field label="Vendor"><input name="vendor" defaultValue="Amazon" required /></Field>
          <Field label="Product URL"><input name="itemUrl" type="url" placeholder="https://…" /></Field>
          <Field label="Budget category"><select name="categoryId" defaultValue=""><option value="">Uncategorized</option>{view.categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}</select></Field>
          <Field label="Quantity"><input name="quantity" type="number" min="1" defaultValue="1" required /></Field>
          <Field label="Unit price"><input name="unitPriceDollars" type="number" min="0" step="0.01" required /></Field>
          <Field label="Shipping / tax estimate"><input name="shippingDollars" type="number" min="0" step="0.01" defaultValue="0" /></Field>
          <Field label="Needed by"><input name="neededBy" type="date" /></Field>
          <Field label="Why the team needs it" hint="Approvers should understand the outcome, not just the part." wide><textarea name="purpose" required rows={3} placeholder="Needed to finish the elevator rebuild before our first event…" /></Field>
          <button className="app-button" disabled={busy}>Submit for approval</button>
        </form>
      </article>
    </section>

    {budgetLines.length > 0 ? (
      <section className="app-card">
        <header className="biz-card-head">
          <div>
            <span className="biz-overline">Budget vs recorded spend</span>
            <h2>Season plan against the unified ledger.</h2>
          </div>
        </header>
        <div className="biz-category-grid">
          {budgetLines.map((line) => (
            <article key={line.categoryId ?? line.name}>
              <header>
                <strong>{line.name}</strong>
              </header>
              <footer>
                <span>{describeBudgetLine(line)}</span>
              </footer>
            </article>
          ))}
        </div>
      </section>
    ) : null}

    <section className="app-card">
      <header className="biz-card-head"><div><span className="biz-overline">Category control</span><h2>Allocation vs. committed spend</h2></div><strong>{money(view.categories.reduce((total, category) => total + category.allocatedCents, 0))} allocated</strong></header>
      <div className="biz-category-grid">{view.categories.map((category) => { const spent = categorySpend.get(category.id) ?? 0; const used = percent(spent, category.allocatedCents); return <article key={category.id}><header><strong>{category.name}</strong><span>{used}%</span></header><div className="biz-progress"><i style={{ width: `${used}%` }} /></div><footer><span>{money(spent)} committed</span><span>{money(category.allocatedCents)} allocated</span></footer></article>; })}{!view.categories.length ? <p className="biz-empty-inline">A finance lead can add categories so requests roll up to robot, travel, outreach, tools, and more.</p> : null}</div>
    </section>

    <section className="app-card">
      <header className="biz-card-head"><div><span className="biz-overline">Purchase queue</span><h2>From request to receiving</h2></div><span className="biz-count">{view.purchases.length}</span></header>
      <div className="biz-table-wrap"><table className="biz-table"><thead><tr><th>Request</th><th>Category</th><th>Total</th><th>Needed</th><th>Status</th><th>Action</th></tr></thead><tbody>{view.purchases.map((purchase) => <PurchaseRow key={purchase.id} purchase={purchase} canManage={view.canManageFinance} busy={busy} mutate={mutate} />)}{!view.purchases.length ? <tr><td colSpan={6}>No purchase requests yet. Students can submit the first one above.</td></tr> : null}</tbody></table></div>
    </section>
  </div>;
}

function PurchaseRow({ purchase, canManage, busy, mutate }: { purchase: PurchaseRequest; canManage: boolean; busy: boolean; mutate: Mutate }) {
  const next: Partial<Record<PurchaseRequest["status"], PurchaseRequest["status"]>> = { submitted: "approved", approved: "ordered", ordered: "received" };
  const nextStatus = next[purchase.status];
  // One move forward is the loud control; rejecting a student's request is a deliberate,
  // confirmed choice behind the overflow — never a button sitting next to "Approve".
  const rowActions: ActionSpec[] = nextStatus
    ? [
        {
          id: "advance",
          label: nextStatus === "approved" ? "Approve" : nextStatus === "ordered" ? "Mark ordered" : "Received",
          intent: "primary",
          disabled: busy,
          onClick: () => void mutate({ action: "set-purchase-status", purchaseId: purchase.id, status: nextStatus }),
        },
        ...(purchase.status === "submitted"
          ? [
              {
                id: "reject",
                label: "Reject request",
                intent: "destructive",
                disabled: busy,
                hint: `Tells ${purchase.requestedByName} this purchase is not happening`,
                onClick: () => void mutate({ action: "set-purchase-status", purchaseId: purchase.id, status: "rejected" }),
              } satisfies ActionSpec,
            ]
          : []),
      ]
    : [];
  return <tr><td><strong>{purchase.itemName}</strong><small>{purchase.quantity} × {money(purchase.unitPriceCents)} · {purchase.vendor} · {purchase.requestedByName}</small>{purchase.itemUrl ? <a href={purchase.itemUrl} target="_blank" rel="noreferrer">Product link ↗</a> : null}<p>{purchase.purpose}</p></td><td>{purchase.categoryName ?? "Uncategorized"}</td><td><strong>{money(purchase.totalCents)}</strong></td><td>{purchase.neededBy ?? "—"}</td><td><ToneBadge tone={purchase.status === "rejected" ? "danger" : purchase.status === "received" ? "good" : purchase.status === "submitted" ? "warn" : "blue"}>{statusLabel(purchase.status)}</ToneBadge></td><td>{canManage && nextStatus ? <div className="biz-row-actions"><ActionMenu tone="row" maxSecondary={0} label={`${purchase.itemName} request`} triggerTestId={`purchase-more:${purchase.id}`} actions={rowActions} /></div> : <span className="app-muted">{purchase.orderedOn ?? "—"}</span>}</td></tr>;
}

function Grants({ view, busy, submit, mutate }: { view: BusinessView; busy: boolean; submit: Submit; mutate: Mutate }) {
  const [selectedDraft, setSelectedDraft] = useState(view.drafts[0]?.id ?? "");
  const draft = view.drafts.find((item) => item.id === selectedDraft) ?? view.drafts[0];
  /**
   * One row of related destinations, not three.
   *
   * Sponsor CRM is a workbench in the tab bar directly above this panel, so the
   * strip was repeating a tab; the sentence underneath then repeated the strip's
   * own workbench and writer links with different wording, and the empty state
   * repeated all of it a third time. Keep only what the tab bar does not carry.
   */
  const grantsRelated = useMemo(
    () => BUSINESS_GRANTS_RELATED_INCLUDE.filter((id) => id !== "sponsors"),
    [],
  );
  return (
    <div className="biz-stack">
      <BusinessRelated
        orgId={view.orgId}
        active="grants"
        include={grantsRelated}
        ariaLabel="Related grant writing tools"
      />
      <div className="biz-detail-link">
        <span>
          Guided need · impact · budget · timeline essays live in the grant writing workbench
          above. Reporting on an award you already won:
        </span>
        <a href={`/grant-report?orgId=${encodeURIComponent(view.orgId)}`}>Grant report →</a>
      </div>
      {!view.grants.length ? (
        <EmptyState
          soft
          badge={view.canManageFinance ? "Get started" : "Setup"}
          badgeTone={view.canManageFinance ? "" : "setup"}
          title={view.canManageFinance ? "No grant applications yet" : "Grant pipeline is empty"}
          description="Add an opportunity in the form below, or compose narratives in the writing workbench linked above. Award $ appears only after you record a real award."
        />
      ) : null}
      <section className="biz-grid two">
        <article className="app-card">
          <span className="biz-overline">Grant pipeline</span>
          <h2>Turn a deadline into an owned plan.</h2>
          <form className="biz-form-grid" onSubmit={(event) => void submit(event, "add-grant", ["requested"])}>
            <Field label="Funder">
              <input name="funder" required placeholder="Community Foundation" />
            </Field>
            <Field label="Opportunity">
              <input name="title" required placeholder="Youth STEM Innovation Grant" />
            </Field>
            <Field label="Source">
              <input name="sourceUrl" type="url" placeholder="https://…" />
            </Field>
            <Field label="Deadline">
              <input name="deadline" type="date" />
            </Field>
            <Field label="Request amount" hint="Optional ask — leave blank rather than inventing an award.">
              <input name="requestedDollars" type="number" min="0" step="0.01" placeholder="Your ask" />
            </Field>
            <Field label="Owner">
              <input name="ownerName" placeholder="Student + mentor pair" />
            </Field>
            <Field label="Purpose / project" wide>
              <textarea name="purpose" required rows={3} placeholder="Exactly what this funding would make possible…" />
            </Field>
            <Field label="Eligibility" wide>
              <textarea name="eligibility" rows={2} placeholder="501(c)(3), geography, grade levels…" />
            </Field>
            <Field label="Requirements" wide>
              <textarea name="requirements" rows={2} placeholder="Prompts, attachments, character limits, reporting…" />
            </Field>
            <button className="app-button" disabled={busy}>
              Add to pipeline
            </button>
          </form>
        </article>
        <article className="app-card biz-writer">
          <span className="biz-overline">Template writing studio</span>
          <h2>Draft faster without inventing a single metric.</h2>
          <p>
            Template drafts pull only from this team&apos;s Impact log and award history — not metered AI. For AI assist
            with hard cutoffs, open the grant writing workbench or Writer.
          </p>
          <form className="biz-form-grid" onSubmit={(event) => void submit(event, "generate-draft")}>
            <Field label="Document">
              <select name="documentType" defaultValue="grant_narrative">
                <option value="grant_narrative">Grant narrative</option>
                <option value="sponsor_email">Sponsor introduction</option>
                <option value="thank_you">Sponsor thank-you</option>
                <option value="renewal">Renewal request</option>
              </select>
            </Field>
            <Field label="Audience">
              <input name="audience" required placeholder="Foundation review committee" />
            </Field>
            <Field label="Sponsor (optional)">
              <select name="sponsorName" defaultValue="">
                <option value="">No specific sponsor</option>
                {view.sponsors.map((sponsor) => (
                  <option key={sponsor.id}>{sponsor.name}</option>
                ))}
              </select>
            </Field>
            <Field label="Goal" wide>
              <textarea name="goal" rows={3} required placeholder="Fund student tool certifications and safety equipment…" />
            </Field>
            <button className="app-button" disabled={busy}>
              Create sourced draft
            </button>
          </form>
        </article>
      </section>

      <section className="app-card">
        <header className="biz-card-head">
          <div>
            <span className="biz-overline">Application board</span>
            <h2>Research → draft → review → submit → report</h2>
          </div>
          <span className="biz-count">{view.grants.length}</span>
        </header>
        <div className="biz-grant-board">
          {GRANT_STATUSES.map((status) => (
            <div key={status}>
              <header>
                <span>{statusLabel(status)}</span>
                <b>{view.grants.filter((grant) => grant.status === status).length}</b>
              </header>
              {view.grants
                .filter((grant) => grant.status === status)
                .map((grant) => (
                  <GrantCard key={grant.id} grant={grant} canManage={view.canManageFinance} busy={busy} mutate={mutate} />
                ))}
            </div>
          ))}
        </div>
      </section>

      <section className="app-card">
        <header className="biz-card-head">
          <div>
            <span className="biz-overline">Draft library</span>
            <h2>Reusable writing with its receipts attached</h2>
          </div>
          {view.drafts.length ? (
            <select value={draft?.id} onChange={(event) => setSelectedDraft(event.target.value)}>
              {view.drafts.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.title}
                </option>
              ))}
            </select>
          ) : null}
        </header>
        {draft ? (
          <div className="biz-draft">
            <article>
              <pre>{draft.body}</pre>
              <button type="button" onClick={() => void navigator.clipboard.writeText(draft.body)}>
                Copy draft
              </button>
            </article>
            <aside>
              <h3>Evidence used</h3>
              {draft.evidence.map((item, index) => (
                <div key={`${item.label}-${index}`}>
                  <strong>{item.label}</strong>
                  <span>{item.value}</span>
                  {item.source.startsWith("http") ? (
                    <a href={item.source} target="_blank" rel="noreferrer">
                      Source ↗
                    </a>
                  ) : (
                    <small>{item.source}</small>
                  )}
                </div>
              ))}
              {!draft.evidence.length ? (
                <p>No quantitative evidence was available. Add verified Impact activities or awards before final submission.</p>
              ) : null}
              <p className="biz-review-warning">
                Human review required before sending. Confirm names, requirements, dates, and every claim.
              </p>
            </aside>
          </div>
        ) : (
          <EmptyState
            soft
            title="No sourced drafts yet"
            description="Generate a template draft above, or open the grant writing workbench for guided fields and metered AI."
          >
            <a className="app-button secondary" href={`/team/grants?orgId=${encodeURIComponent(view.orgId)}`}>
              Grant writing workbench
            </a>
          </EmptyState>
        )}
      </section>
    </div>
  );
}

function GrantCard({ grant, canManage, busy, mutate }: { grant: GrantApplication; canManage: boolean; busy: boolean; mutate: Mutate }) {
  const index = GRANT_STATUSES.indexOf(grant.status);
  const next = GRANT_STATUSES[Math.min(index + 1, GRANT_STATUSES.length - 1)] ?? grant.status;
  const canAdvance = !["awarded", "declined"].includes(grant.status) && next !== grant.status;
  return <article><strong>{grant.title}</strong><span>{grant.funder}</span><small>{grant.deadline ? `Due ${grant.deadline}` : "No deadline"} · {money(grant.requestedCents)}</small><p>{grant.purpose}</p>{grant.sourceUrl ? <a href={grant.sourceUrl} target="_blank" rel="noreferrer">Opportunity source ↗</a> : null}{canAdvance ? <button disabled={busy || (next === "awarded" && !canManage)} onClick={() => void mutate({ action: "set-grant-status", grantId: grant.id, status: next, awardedCents: next === "awarded" ? grant.requestedCents : 0 })}>Move to {statusLabel(next)}</button> : null}</article>;
}

function Evidence({ view, busy, submit }: { view: BusinessView; busy: boolean; submit: Submit }) {
  const grouped = useMemo(() => {
    const byYear = new Map<number, BusinessView["awards"]>();
    for (const award of view.awards) byYear.set(award.seasonYear, [...(byYear.get(award.seasonYear) ?? []), award]);
    return byYear;
  }, [view.awards]);
  return <div className="biz-stack">
    <div className="biz-detail-link">
      <span>Need FIRST catalog prompts, essay drafts, character limits, and submission status?</span>
      <a href={`/team/awards?orgId=${encodeURIComponent(view.orgId)}`}>Open the full awards workbench →</a>
      <a href={`/award-tracker?orgId=${encodeURIComponent(view.orgId)}`}>Award tracker →</a>
    </div>
    <section className="biz-grid two"><article className="app-card"><span className="biz-overline">Verified achievement record</span><h2>Add an award once. Reuse it for years.</h2><form className="biz-form-grid" onSubmit={(event) => void submit(event, "add-award")}><Field label="Award"><input name="awardName" required placeholder="Engineering Inspiration Award" /></Field><Field label="Event"><input name="eventName" placeholder="District Championship" /></Field><Field label="Level"><input name="awardLevel" placeholder="Winner, finalist, district…" /></Field><Field label="Official source"><input name="sourceUrl" type="url" placeholder="https://…" /></Field><Field label="Why it mattered" hint="Capture the story future students would otherwise lose." wide><textarea name="story" rows={4} placeholder="What the team did, who led it, and what changed…" /></Field><button className="app-button" disabled={busy}>Add award to {view.seasonYear}</button></form></article><article className="app-card biz-impact-link"><span className="biz-overline">Live impact evidence</span><h2>Your grant facts are only as strong as this log.</h2><div className="biz-evidence-stats"><b>{view.impact.activities}<small>activities</small></b><b>{view.impact.hours}<small>hours</small></b><b>{view.impact.peopleReached.toLocaleString()}<small>people reached</small></b></div><p>These figures flow directly into sourced writing drafts. Add outreach, mentoring, demos, and service in Community Impact.</p><a className="app-button" href={`/impact?orgId=${encodeURIComponent(view.orgId)}&season=${view.seasonYear}`}>Open Community Impact</a></article></section><section className="app-card"><header className="biz-card-head"><div><span className="biz-overline">Team history</span><h2>The proof that graduates with the team—not with a person.</h2></div><span className="biz-count">{view.awards.length}</span></header><div className="biz-award-years">{[...grouped.entries()].sort(([a], [b]) => b - a).map(([year, awards]) => <section key={year}><h3>{year}</h3><div>{awards.map((award) => <article key={award.id}><ToneBadge tone="good">Achievement</ToneBadge><strong>{award.awardName}</strong><span>{[award.eventName, award.awardLevel].filter(Boolean).join(" · ") || "Team record"}</span>{award.story ? <p>{award.story}</p> : null}{award.sourceUrl ? <a href={award.sourceUrl} target="_blank" rel="noreferrer">Verify source ↗</a> : null}</article>)}</div></section>)}{!view.awards.length ? <p className="biz-empty-inline">Start with the team’s most recent judged or competition award.</p> : null}</div></section>
  </div>;
}
