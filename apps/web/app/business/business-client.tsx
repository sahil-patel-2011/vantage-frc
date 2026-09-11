"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { EmptyState, PageHeader, TabBar, ToolStrip, Button } from "../../components/ui";
import { HelpTip } from "../../components/help-tip";
import { OfflineBanner } from "../../components/offline-banner";
import { classifyLoadFailure, loadFailureCopy } from "../../lib/ui/load-failure";
import type { BusinessPortalView } from "../../lib/business-portal";
import {
  businessDefaultTab,
  fundingModelFromFlags,
} from "../../lib/funding-profile";
import { SoftAccessDenied } from "../../components/hub-access-gate";
import { sectionHelpFor } from "../../lib/help/section-help";
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
} from "../../lib/nav/hubs";
import { useClientAccessProfile } from "../../lib/nav/use-client-access";
import { PartnerPlacementsPanel } from "./partner-placements-panel";
import { SponsorPipelinePanel } from "./sponsor-pipeline-panel";
import {
  isTab,
  readTabFromUrl,
  redirectMoreToolTab,
  writeTabToUrl,
  type Tab,
} from "./business-helpers";
import { Budget, Evidence, Grants, Overview } from "./business-panels";
import { ToneBadge } from "./business-ui";
import "../product-hub.css";

const OrdersClient = dynamic(() => import("../orders/orders-client"), { ssr: false });
const SeasonFinanceClient = dynamic(() => import("./season-finance-client"), { ssr: false });
const SponsorshipClient = dynamic(() => import("../sponsorship/sponsorship-client"), { ssr: false });

const BUSINESS_HUB = hubById("business");
const WORKBENCHES = hubPrimaryTabs(BUSINESS_HUB);

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
  const appliedFundingDefault = useRef(false);

  useEffect(() => {
    if (typeof window === "undefined" || !live || appliedFundingDefault.current) return;
    if (new URLSearchParams(window.location.search).get("tab")) {
      appliedFundingDefault.current = true;
      return;
    }
    appliedFundingDefault.current = true;
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
    <main className="module-page business-page product-hub product-hub--business">
      <PageHeader
        breadcrumbs="Business"
        title="Business"
        description={
          live
            ? `Money, sponsors, grants, and awards for ${live.teamNumber ? `FRC ${live.teamNumber}` : live.orgName} · ${live.seasonYear}.`
            : "Money, sponsors, grants, and outreach for this season."
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

      <OfflineBanner feature="Business" />
      <TabBar
        aria-label="Business sections"
        value={workbenchId}
        onChange={(id) => {
          if (isTab(id)) selectTab(id);
          else selectTab((hubWorkbenchId(BUSINESS_HUB, id) as Tab) || "overview");
        }}
        tabs={visibleWorkbenches.map((entry) => ({ id: entry.id, label: entry.label }))}
        className="product-hub-tabs"
      >
        <HelpTip entry={sectionHelpFor("business", tab) ?? sectionHelpFor("business", workbenchId)} />
      </TabBar>
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
                  <Button as="a" variant="primary" href={copy.primary.href}>
                    {copy.primary.label}
                  </Button>
                ) : null}
                {copy.showRetry ? (
                  <Button variant="secondary" type="button" onClick={() => void load()}>
                    Retry
                  </Button>
                ) : null}
              </EmptyState>
            );
          })()
        ) : (
          <EmptyState soft title="Opening business…" description="Loading this season’s money, grants, and awards." aria-busy />
        )
      ) : null}

      {view?.status === "setup_required" ? (
        <EmptyState
          badge="Setup required"
          badgeTone="setup"
          title="Choose your team"
          description="Choose your team, then come back to start this season’s money plan."
        >
          <Button as="a" variant="primary" href="/workspace">
            Choose your team
          </Button>
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
