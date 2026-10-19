"use client";

import { staleCopyNotice, staleCopyProps } from "../../lib/ui/stale-copy";
import dynamic from "next/dynamic";
import { availableSeasonYears, currentSeasonYear } from "@vantage/game-year";
import { HubPanelSkeleton } from "../../components/product-hub";
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { useFollowUrl } from "../../lib/nav/use-follow-url";
import { EmptyState, Button, PageMain } from "../../components/ui";
import { hubPageTitle } from "../../lib/nav/hub-navigation";
import { MoneyAddMenu } from "./money-add-menu";
import { OfflineBanner } from "../../components/offline-banner";
import { HubSections } from "../../components/hub-sections";
import { classifyLoadFailure, loadFailureCopy } from "../../lib/ui/load-failure";
import { isBusinessPortalView, type BusinessPortalView } from "../../lib/business-portal";
import { FEATURE_API_TIMEOUT_MS, persistOrgIdInUrl } from "../../lib/nav/resolve-org";
import { getFeatureSnapshot, putFeatureSnapshot } from "../../lib/offline/feature-cache";
import { HUB_SECTION_DENIED_COPY, SoftAccessDenied } from "../../components/hub-access-gate";
import {
  clientCanAccessHub,
  filterSponsorTabs,
  filterTabsByHubAccess,
  SPONSOR_TAB_IDS,
} from "../../lib/nav/hub-access-filter";
import {
  hubById,
  hubPrimaryTabs,
  hubWorkbenchId,
} from "../../lib/nav/hubs";
import { useClientAccessProfile } from "../../lib/nav/use-client-access";
import { PartnerPlacementsPanel } from "./partner-placements-panel";
import { SponsorPipelinePanel } from "./sponsor-pipeline-panel";
import { hubDocumentTitle } from "../../lib/nav/hub-title";
import { useDocumentTitle } from "../../lib/ui/use-document-title";
import {
  isTab,
  readTabFromUrl,
  redirectMoreToolTab,
  writeTabToUrl,
  type Tab,
} from "./business-helpers";
import { AwardHistory, Budget, Evidence, Grants, Overview } from "./business-panels";
import "../product-hub.css";
import { withWaitlistLink } from "../../components/waitlist-link";
import { MoneyManagersLine } from "../team/admin/money-managers-line";
import { actionFailureMessage } from "../../lib/ui/action-failure";

const OrdersClient = dynamic(() => import("../orders/orders-client"), { ssr: false, loading: HubPanelSkeleton });
const SeasonFinanceClient = dynamic(() => import("./season-finance-client"), { ssr: false, loading: HubPanelSkeleton });
const SponsorshipClient = dynamic(() => import("../sponsorship/sponsorship-client"), { ssr: false, loading: HubPanelSkeleton });

const BUSINESS_HUB = hubById("business");
const WORKBENCHES = hubPrimaryTabs(BUSINESS_HUB);

/**
 * Tabs that load their own data and only need the hub frame (team, role, seasons) from
 * /api/business. On these the view is fetched as a shell (`sections=shell`), skipping the
 * sponsor, grant, prospect, outreach and award reads they never show.
 */
const SELF_LOADING_TABS: ReadonlySet<Tab> = new Set<Tab>(["finance", "orders", "sponsorship", "placements"]);

function isPartialView(view: BusinessPortalView | null): boolean {
  return Boolean(view && (view as { partial?: boolean }).partial);
}
function businessCacheOrg(data: BusinessPortalView, orgHint: string): string {
  if (data.status === "live" && data.orgId.trim()) return data.orgId;
  return orgHint;
}

async function persistBusinessSnapshot(
  orgHint: string,
  seasonHint: string,
  data: BusinessPortalView,
): Promise<void> {
  const cacheOrg = businessCacheOrg(data, orgHint);
  if (!cacheOrg) return;
  const seasonKey = String(data.seasonYear);
  try {
    await putFeatureSnapshot("business", cacheOrg, data, seasonHint || seasonKey);
    if (!orgHint) await putFeatureSnapshot("business", "_", data, seasonHint || seasonKey);
  } catch {
    // Live Business already painted; IndexedDB is best-effort.
  }
}

export default function BusinessClient({ initialTab = null }: { initialTab?: string | null }) {
  const access = useClientAccessProfile();
  const [view, setView] = useState<BusinessPortalView | null>(null);
  // `?tab=` as the server saw it, so the server HTML already has the right heading.
  const [tab, setTab] = useState<Tab>(() => (isTab(initialTab) ? initialTab : "overview"));
  useDocumentTitle(hubDocumentTitle("business", tab));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  // Kept apart from mutation errors so an expired session offers sign-in, not a Retry that cannot work.
  const [loadFailure, setLoadFailure] = useState<{ status: number | null; message: string } | null>(null);
  const [notice, setNotice] = useState("");
  const [fromCache, setFromCache] = useState(false);
  const [cachedAt, setCachedAt] = useState<string | null>(null);
  const viewRef = useRef<BusinessPortalView | null>(null);
  viewRef.current = view;
  const tabRef = useRef<Tab>(tab);
  tabRef.current = tab;
  // Team and season from the address, known before /api/business answers, so Money can start
  // its own reads at once instead of waiting for the hub view.
  const [earlyFinance, setEarlyFinance] = useState<{ orgId: string; seasonYear: number } | null>(null);

  const selectTab = useCallback((next: Tab) => {
    setTab(next);
    writeTabToUrl(next);
  }, []);

  const load = useCallback(async (seasonOverride?: number) => {
    const params = new URLSearchParams(window.location.search);
    const orgHint = params.get("orgId")?.trim() ?? "";
    const seasonHint = seasonOverride
      ? String(seasonOverride)
      : params.get("season") && Number.isFinite(Number(params.get("season")))
        ? String(Number(params.get("season")))
        : String(new Date().getFullYear());
    let hadCache = Boolean(viewRef.current);
    try {
      const cached = await getFeatureSnapshot<BusinessPortalView>(
        "business",
        orgHint || "_",
        seasonHint,
      );
      if (!viewRef.current && cached?.data && isBusinessPortalView(cached.data)) {
        setView(cached.data);
        setFromCache(true);
        setCachedAt(cached.cachedAt);
        hadCache = true;
      }
    } catch {
      // IndexedDB missing or blocked; live fetch still runs.
    }
    setError("");
    setLoadFailure(null);
    const query = new URLSearchParams();
    if (orgHint) query.set("orgId", orgHint);
    if (seasonOverride) query.set("season", String(seasonOverride));
    const shell = SELF_LOADING_TABS.has(tabRef.current);
    if (shell) query.set("sections", "shell");
    try {
      const response = await fetch(`/api/business?${query.toString()}`, {
        cache: "no-store",
        signal: AbortSignal.timeout(FEATURE_API_TIMEOUT_MS),
      });
      const data = (await response.json()) as BusinessPortalView | { error?: string };
      if (response.status === 401 || response.status === 403) {
        setView(null);
        setFromCache(false);
        setCachedAt(null);
        setLoadFailure({
          status: response.status,
          message: ("error" in data && data.error) || "Choose your team",
        });
        return;
      }
      if (!response.ok || !isBusinessPortalView(data)) {
        if (hadCache || viewRef.current) {
          setFromCache(true);
          setError(staleCopyNotice("Business"));
          setLoadFailure(null);
        } else {
          setLoadFailure({
            status: response.status,
            message: ("error" in data && data.error) || "Could not load portal",
          });
        }
        return;
      }
      setLoadFailure(null);
      setView(data);
      setFromCache(false);
      setCachedAt(null);
      if (data.status === "live" && data.orgId) persistOrgIdInUrl(data.orgId);
      // A shell view has no sponsor/grant rows; keep the device copy a full one.
      if (!isPartialView(data)) await persistBusinessSnapshot(orgHint, seasonHint, data);
    } catch (cause) {
      if (hadCache || viewRef.current) {
        setFromCache(true);
        setError(staleCopyNotice("Business"));
        setLoadFailure(null);
      } else {
        setLoadFailure({
          status: null,
          message: actionFailureMessage(cause, "Could not load the business portal"),
        });
      }
    }
  }, []);

  useEffect(() => {
    if (redirectMoreToolTab()) return;
    const initial = readTabFromUrl();
    setTab(initial);
    tabRef.current = initial;
    const params = new URLSearchParams(window.location.search);
    const orgHint = params.get("orgId")?.trim() ?? "";
    const seasonParam = Number(params.get("season"));
    if (initial === "finance" && orgHint) {
      setEarlyFinance({
        orgId: orgHint,
        // The same default /api/business uses when the address names no season.
        seasonYear: Number.isInteger(seasonParam) && seasonParam >= 2000 ? seasonParam : currentSeasonYear(),
      });
    }
    void load();
  }, [load]);

  // "Open purchase orders" on Money links to ?tab=orders on this same page; the address
  // changed and the page stayed on Money, because the tab was read only on first load.
  useFollowUrl(() => {
    const next = readTabFromUrl();
    setTab((current) => (current === next ? current : next));
  });

  const live = view?.status === "live" ? view : null;
  // Opened on a self-loading tab, then moved to one that reads the hub view's rows: load the
  // full view first and show the skeleton meanwhile, never the shell's empty lists.
  const needsFullView = Boolean(live && isPartialView(live) && !SELF_LOADING_TABS.has(tab));
  const fullViewRequested = useRef<string | null>(null);
  useEffect(() => {
    // A full view landed: a later shell view of the same season may be upgraded again.
    if (live && !isPartialView(live)) fullViewRequested.current = null;
    if (!needsFullView || !live) return;
    const key = `${live.orgId}:${live.seasonYear}`;
    if (fullViewRequested.current === key) return;
    fullViewRequested.current = key;
    void load(live.seasonYear);
  }, [needsFullView, live, load]);
  const financeTarget = live
    ? { orgId: live.orgId, seasonYear: live.seasonYear }
    : !view && !loadFailure && earlyFinance && tab === "finance"
      ? earlyFinance
      : null;
  const sponsorsAllowed = live?.sponsorsAllowed ?? access.sponsorsAllowed;
  // /business always opens on Overview unless the link names a tab. Jumping to
  // Money or Sponsors based on how the team is funded made the page open
  // somewhere different each time.
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
        signal: AbortSignal.timeout(FEATURE_API_TIMEOUT_MS),
      });
      const data = (await response.json()) as BusinessPortalView | { error?: string };
      if (!response.ok || !isBusinessPortalView(data)) throw new Error("error" in data && data.error ? data.error : "Request failed");
      setView(data);
      setNotice("Saved. The whole team now sees the latest record.");
      await persistBusinessSnapshot(live.orgId, String(live.seasonYear), data);
      return true;
    } catch (cause) {
      setError(actionFailureMessage(cause, "That didn't save. Try again."));
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
      setError(actionFailureMessage(cause, "Sponsor research failed"));
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
        description={HUB_SECTION_DENIED_COPY}
      />
    );
  }

  return (
    <PageMain className="module-page business-page product-hub product-hub--business">
      <div className="workspace-hub-header">
        <div className="hub-bar-id"><span className="workspace-hub-eyebrow">Business</span><h1>{hubPageTitle(BUSINESS_HUB, tab)}</h1></div>
        <div className="workspace-hub-actions">
        {live ? (
          <MoneyAddMenu orgId={orgId ?? null} canManageFinances={live.canManageFinances} viewOnly={live.role === "viewer"} />
        ) : null}
        </div>
      </div>
      <HubSections hubId="business" orgId={orgId ?? null} hubAccess={access.hubAccess} sponsorsAllowed={sponsorsAllowed} />

      <OfflineBanner feature="Business" fromCache={fromCache} cachedAt={cachedAt} />

      {/* Below workspace navigation. A save error or a slow first load used
          to push Business's own navigation down the page — the one thing you
          need to still be where it was when something goes wrong. These belong
          with the panel they are talking about. */}
      {error ? (
        <div {...staleCopyProps(error, "biz-alert danger")}>
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
        loadFailure && (loadFailure.status === 401 || loadFailure.status === 403) ? (
          <EmptyState
            badge="Needs setup"
            badgeTone="setup"
            title="Choose your team"
            description="Choose your team, then come back to start this season’s money plan."
          >
            <Button as="a" variant="primary" href="/workspace">
              Choose your team
            </Button>
          </EmptyState>
        ) : loadFailure ? (
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
        ) : financeTarget ? null : (
          // One loading pattern across the hubs: the card-shaped skeleton (A6-20).
          <HubPanelSkeleton />
        )
      ) : null}

      {view?.status === "setup_required" ? (
        <EmptyState
          badge="Needs setup"
          badgeTone="setup"
          title="Choose your team"
          description={withWaitlistLink(view.message)}
          className="biz-setup"
        >
          <div className="biz-setup-actions">
            <Button as="a" variant="primary" href="/workspace">
              Choose your team
            </Button>
            <a className="biz-setup-waitlist" href="/#waitlist">
              Join the waitlist
            </a>
          </div>
        </EmptyState>
      ) : null}

      {live ? (
        <>
          <label className="biz-season">
            Season
            <select value={live.seasonYear} onChange={(event) => void load(Number(event.target.value))}>
              {availableSeasonYears(live.seasons).map(season => <option key={season} value={season}>{season}</option>)}
            </select>
          </label>
          {needsFullView ? (
            error ? (
              <EmptyState soft title="This tab could not load" description="Check your connection and try again.">
                <Button variant="secondary" type="button" onClick={() => void load(live.seasonYear)}>
                  Retry
                </Button>
              </EmptyState>
            ) : (
              <HubPanelSkeleton />
            )
          ) : null}
          {needsFullView ? null : <>
          {tab === "overview" ? <Overview view={live} setTab={selectTab} /> : null}
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
          {tab === "evidence" ? <Evidence view={live} /> : null}
          {tab === "achievements" ? <AwardHistory view={live} busy={busy} submit={submit} /> : null}
          </>}
        </>
      ) : null}

      {/* Outside the live block so Money keeps the same element (and its in-flight reads)
          when the hub view lands after it started from the address's team and season. */}
      {tab === "finance" && financeTarget ? (
        <div className="product-hub-panel">
          {/* Who can change money here (0714): the owner and the people they chose. */}
          <MoneyManagersLine orgId={financeTarget.orgId} ownerHint="To change it, open a person’s Access on Team admin." />
          <SeasonFinanceClient embedded orgId={financeTarget.orgId} seasonYear={financeTarget.seasonYear} />
        </div>
      ) : null}
    </PageMain>
  );
}
