"use client";

import dynamic from "next/dynamic";
import { HubPanelSkeleton } from "../../components/product-hub";
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { useFollowUrl } from "../../lib/nav/use-follow-url";
import { EmptyState, Button } from "../../components/ui";
import { hubPageTitle } from "../../lib/nav/hub-navigation";
import { HubContextActions } from "../../components/hub-context-actions";
import { MoneyAddMenu } from "./money-add-menu";
import { OfflineBanner } from "../../components/offline-banner";
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
import {
  readTabFromUrl,
  redirectMoreToolTab,
  writeTabToUrl,
  type Tab,
} from "./business-helpers";
import { Budget, Evidence, Grants, Overview } from "./business-panels";
import "../product-hub.css";
import { withWaitlistLink } from "../../components/waitlist-link";

const OrdersClient = dynamic(() => import("../orders/orders-client"), { ssr: false, loading: HubPanelSkeleton });
const SeasonFinanceClient = dynamic(() => import("./season-finance-client"), { ssr: false, loading: HubPanelSkeleton });
const SponsorshipClient = dynamic(() => import("../sponsorship/sponsorship-client"), { ssr: false, loading: HubPanelSkeleton });

const BUSINESS_HUB = hubById("business");
const WORKBENCHES = hubPrimaryTabs(BUSINESS_HUB);
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

export default function BusinessClient() {
  const access = useClientAccessProfile();
  const [view, setView] = useState<BusinessPortalView | null>(null);
  const [tab, setTab] = useState<Tab>("overview");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  // Kept apart from mutation errors so an expired session offers sign-in, not a Retry that cannot work.
  const [loadFailure, setLoadFailure] = useState<{ status: number | null; message: string } | null>(null);
  const [notice, setNotice] = useState("");
  const [fromCache, setFromCache] = useState(false);
  const [cachedAt, setCachedAt] = useState<string | null>(null);
  const viewRef = useRef<BusinessPortalView | null>(null);
  viewRef.current = view;

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
          setError("Could not refresh Business. Showing the last copy on this device.");
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
      await persistBusinessSnapshot(orgHint, seasonHint, data);
    } catch (cause) {
      if (hadCache || viewRef.current) {
        setFromCache(true);
        setError("Could not refresh Business. Showing the last copy on this device.");
        setLoadFailure(null);
      } else {
        setLoadFailure({
          status: null,
          message: cause instanceof Error ? cause.message : "Could not load the business portal",
        });
      }
    }
  }, []);

  useEffect(() => {
    if (redirectMoreToolTab()) return;
    setTab(readTabFromUrl());
    void load();
  }, [load]);

  // "Open purchase orders" on Money links to ?tab=orders on this same page; the address
  // changed and the page stayed on Money, because the tab was read only on first load.
  useFollowUrl(() => {
    const next = readTabFromUrl();
    setTab((current) => (current === next ? current : next));
  });

  const live = view?.status === "live" ? view : null;
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
  const workspaceTabs = useMemo(() => filterTabsByHubAccess(
    filterSponsorTabs(BUSINESS_HUB.tabs, sponsorsAllowed), access.hubAccess, "business",
  ).filter(entry => visibleWorkbenches.some(root => root.id === (entry.group ?? entry.id))),
  [access.hubAccess, sponsorsAllowed, visibleWorkbenches]);
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
        description={HUB_SECTION_DENIED_COPY}
      />
    );
  }

  return (
    <main className="module-page business-page product-hub product-hub--business">
      <div className="workspace-hub-header">
        <div className="hub-bar-id"><h1>{hubPageTitle(BUSINESS_HUB, tab)}</h1></div>
        {live ? <MoneyAddMenu orgId={orgId ?? null} /> : null}
      </div>

      <OfflineBanner feature="Business" fromCache={fromCache} cachedAt={cachedAt} />

      {/* Below workspace navigation. A save error or a slow first load used
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
        ) : (
          <EmptyState soft title="Opening business…" description="Loading this season’s money, grants, and awards." aria-busy />
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
              {live.seasons.map(season => <option key={season} value={season}>{season}</option>)}
            </select>
          </label>
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
          <HubContextActions hub={BUSINESS_HUB} tab={tab} tabs={workspaceTabs} orgId={live.orgId} canManage={live.canManageFinance} />
        </>
      ) : null}
    </main>
  );
}
