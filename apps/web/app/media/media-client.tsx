"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { SoftAccessDenied } from "../../components/hub-access-gate";
import { OfflineBanner } from "../../components/offline-banner";
import { resolveCutoffErrorCode } from "../../components/usage-cutoff-banner";
import { EmptyState, PageHeader, Button } from "../../components/ui";
import type { MediaView } from "../../lib/media/compute-media";
import {
  classifyMediaShell,
  mediaNextActions,
  mediaShellCopy,
  type MediaNextAction,
  type MediaShellKind,
} from "../../lib/media/media-related";
import {
  clientCanAccessHub,
  filterTabsByHubAccess,
} from "../../lib/nav/hub-access-filter";
import { hubById, hubPrimaryTabs } from "../../lib/nav/hubs";
import { FEATURE_API_TIMEOUT_MS } from "../../lib/nav/resolve-org";
import { getFeatureSnapshot, putFeatureSnapshot } from "../../lib/offline/feature-cache";
import { withOrgHref } from "../../lib/nav/product-nav";
import { useClientAccessProfile } from "../../lib/nav/use-client-access";
import { classifyLoadFailure, loadFailureCopy } from "../../lib/ui/load-failure";
import { readTabFromUrl, writeTabToUrl, type LiveWithDraft, type Tab } from "./media-helpers";
import { LiveMediaWorkspace } from "./media-live-workspace";
import { MediaRelatedStrip } from "./media-related-strip";
import "./media.css";

const MEDIA_HUB = hubById("media");
const PRIMARY_TABS = hubPrimaryTabs(MEDIA_HUB);

const TABS: Array<{ id: Tab; label: string }> = PRIMARY_TABS.map((tab) => ({
  id: tab.id as Tab,
  label: tab.label,
}));

function isMediaView(value: unknown): value is MediaView {
  if (!value || typeof value !== "object") return false;
  const status = (value as { status?: unknown }).status;
  return status === "setup_required" || status === "live";
}

function mediaCacheOrg(data: MediaView, orgHint: string): string {
  if (typeof data.orgId === "string" && data.orgId.trim()) return data.orgId;
  return orgHint;
}

async function persistMediaSnapshot(orgHint: string, seasonHint: string, data: MediaView): Promise<void> {
  const cacheOrg = mediaCacheOrg(data, orgHint);
  if (!cacheOrg) return;
  const seasonKey = String(data.seasonYear);
  try {
    await putFeatureSnapshot("media", cacheOrg, data, seasonHint || seasonKey);
    if (!orgHint) await putFeatureSnapshot("media", "_", data, seasonHint || seasonKey);
  } catch {
    // Live Media already painted; IndexedDB is best-effort.
  }
}

function MediaNextActionsPanel({ actions }: { actions: MediaNextAction[] }) {
  if (!actions.length) return null;
  return (
    <section
      className="app-card soft-panel edc-next-actions media-next-actions"
      aria-label="Next actions"
    >
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

function MediaShell({
  description,
  orgId,
  shell,
  error,
  errorStatus,
  onRetry,
  children,
}: {
  description: string;
  orgId?: string | null;
  shell: MediaShellKind;
  error?: string;
  errorStatus?: number | null;
  onRetry?: () => void;
  children?: ReactNode;
}) {
  const actions = mediaNextActions({ orgId, shell });
  const copy = mediaShellCopy(shell);
  // A signed-out tablet needs "Sign in again", not a Retry that can never succeed.
  const failure =
    shell === "error"
      ? loadFailureCopy(
          classifyLoadFailure({
            status: errorStatus,
            message: error,
            online: typeof navigator === "undefined" ? true : navigator.onLine,
          }),
          {
            nextPath:
              typeof window === "undefined"
                ? null
                : `${window.location.pathname}${window.location.search}`,
            message: error,
          },
        )
      : null;

  return (
    <main className="module-page media-page soft-gate">
      <PageHeader breadcrumbs="Media" title="Media" description={description}>
        <div className="media-header-actions">
          <MediaRelatedStrip orgId={orgId} />
        </div>
      </PageHeader>
      {children}
      <EmptyState
        soft
        badge={
          shell === "setup"
            ? "Needs setup"
            : shell === "error"
              ? "Unavailable"
              : shell === "empty"
                ? "No media yet"
                : copy.badge
        }
        badgeTone="setup"
        title={failure ? failure.title : copy.title}
        description={failure ? failure.description : error ?? copy.description}
        aria-busy={shell === "loading"}
      >
        {failure?.primary ? (
          <Button as="a" variant="primary" href={failure.primary.href}>
            {failure.primary.label}
          </Button>
        ) : null}
        {shell === "error" && onRetry && (failure?.showRetry ?? true) ? (
          <Button variant="secondary" type="button" onClick={onRetry}>
            Retry
          </Button>
        ) : null}
        {shell === "setup" ? (
          <Button as="a" variant="primary" href={orgId ? withOrgHref("/workspace", orgId) : "/workspace"}>Choose your team</Button>
        ) : null}
        {shell === "empty" ? (
          <Button as="a" variant="primary" href={orgId ? withOrgHref("/media-kit", orgId) : "/media-kit"}>Build Media kit</Button>
        ) : null}
      </EmptyState>
      {shell === "ready" ? <MediaNextActionsPanel actions={actions} /> : null}
    </main>
  );
}

export default function MediaClient() {
  const access = useClientAccessProfile();
  const [view, setView] = useState<MediaView | null>(null);
  const [error, setError] = useState("");
  const [fetchFailed, setFetchFailed] = useState(false);
  // Kept so an expired session offers sign-in instead of a Retry that cannot work.
  const [errorStatus, setErrorStatus] = useState<number | null>(null);
  const [accessDenied, setAccessDenied] = useState(false);
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState<Tab>("calendar");
  const [cutoffCode, setCutoffCode] = useState<string | null>(null);
  const [draftMeta, setDraftMeta] = useState<{ feature: string; generatedAt: string } | null>(null);
  const [fromCache, setFromCache] = useState(false);
  const [cachedAt, setCachedAt] = useState<string | null>(null);
  const viewRef = useRef<MediaView | null>(null);
  viewRef.current = view;

  const visibleTabs = useMemo(
    () => filterTabsByHubAccess(TABS, access.hubAccess, "media"),
    [access.hubAccess],
  );
  const hubDenied = access.ready && !clientCanAccessHub(access.hubAccess, "media");

  const load = useCallback(() => {
    void (async () => {
      const params = new URLSearchParams(window.location.search);
      const urlOrg = params.get("orgId")?.trim() ?? "";
      const seasonQuery = params.get("season") ? Number(params.get("season")) : null;
      const seasonHint =
        seasonQuery != null && Number.isFinite(seasonQuery) ? String(seasonQuery) : "";
      let hadCache = Boolean(viewRef.current);
      try {
        const cached = await getFeatureSnapshot<MediaView>("media", urlOrg || "_", seasonHint);
        if (!viewRef.current && cached?.data && isMediaView(cached.data)) {
          setView(cached.data);
          setFromCache(true);
          setCachedAt(cached.cachedAt);
          hadCache = true;
        }
      } catch {
        // IndexedDB missing or blocked; live fetch still runs.
      }
      setFetchFailed(false);
      setErrorStatus(null);
      setAccessDenied(false);
      setError("");
      const query = new URLSearchParams();
      if (urlOrg) query.set("orgId", urlOrg);
      if (seasonHint) query.set("season", seasonHint);
      const currentTab = readTabFromUrl();
      if (currentTab !== "calendar") query.set("tab", currentTab);
      try {
        const response = await fetch(
          `/api/media${query.toString() ? `?${query.toString()}` : ""}`,
          {
            cache: "no-store",
            signal: AbortSignal.timeout(FEATURE_API_TIMEOUT_MS),
          },
        );
        const data = (await response.json()) as MediaView | { error?: string };
        if (response.status === 403) {
          setAccessDenied(true);
          setError("error" in data && data.error ? data.error : "You do not have access to this tab");
          return;
        }
        if (!response.ok || !isMediaView(data)) {
          if (hadCache || viewRef.current) {
            setFromCache(true);
            setError("Could not refresh Media. Showing the last copy on this device.");
            setFetchFailed(false);
          } else {
            setErrorStatus(response.status);
            setFetchFailed(true);
            setError("error" in data && data.error ? data.error : "Could not load Media");
          }
          return;
        }
        setView(data);
        setFromCache(false);
        setCachedAt(null);
        await persistMediaSnapshot(urlOrg, seasonHint, data);
      } catch {
        if (hadCache || viewRef.current) {
          setFromCache(true);
          setError("Could not refresh Media. Showing the last copy on this device.");
          setFetchFailed(false);
        } else {
          setFetchFailed(true);
          setError("Could not load Media");
        }
      }
    })();
  }, []);

  useEffect(() => {
    setTab(readTabFromUrl());
    load();
  }, [load]);

  useEffect(() => {
    if (!access.ready || !visibleTabs.length) return;
    if (visibleTabs.some((entry) => entry.id === tab)) return;
    const fallback = (visibleTabs[0]?.id as Tab) ?? "calendar";
    setTab(fallback);
    writeTabToUrl(fallback);
  }, [access.ready, tab, visibleTabs]);

  const selectTab = useCallback((next: Tab) => {
    setTab(next);
    writeTabToUrl(next);
  }, []);

  const mutate = useCallback(
    async (payload: Record<string, unknown>, method: "POST" | "PATCH" | "DELETE" = "POST") => {
      if (!view || view.status !== "live" || busy) return false;
      setBusy(true);
      setError("");
      setCutoffCode(null);
      try {
        const response = await fetch("/api/media", {
          method,
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            orgId: view.orgId,
            seasonYear: view.seasonYear,
            ...payload,
          }),
          signal: AbortSignal.timeout(FEATURE_API_TIMEOUT_MS),
        });
        const data = (await response.json()) as
          | LiveWithDraft
          | { error?: string; code?: string; status?: string };
        if (!response.ok) {
          const cutoff = resolveCutoffErrorCode(response.status, data);
          if (cutoff) {
            setCutoffCode(cutoff);
            setError("AI usage limit reached — raise budgets or wait for the billing period to reset.");
            return false;
          }
          setError("error" in data && data.error ? data.error : "Media update failed");
          return false;
        }
        if (!("status" in data) || data.status !== "live") {
          setError("error" in data && data.error ? data.error : "Media update failed");
          return false;
        }
        const live = data as LiveWithDraft;
        if (live.draft?.status === "setup_required") {
          setError(live.draft.message);
          setView(live);
          void persistMediaSnapshot(view.orgId, String(view.seasonYear), live);
          return false;
        }
        if (
          live.draft?.status === "live" &&
          payload.action === "ai-draft" &&
          !payload.itemId &&
          typeof payload.title === "string" &&
          payload.title.trim()
        ) {
          setDraftMeta({ feature: live.draft.feature, generatedAt: live.draft.generatedAt });
          const createResponse = await fetch("/api/media", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              orgId: view.orgId,
              seasonYear: view.seasonYear,
              action: "create-item",
              tab: "drafts",
              title: payload.title,
              platform: payload.platform ?? "other",
              status: "draft",
              caption: live.draft.caption,
              dueAt: live.draft.dueAt,
            }),
            signal: AbortSignal.timeout(FEATURE_API_TIMEOUT_MS),
          });
          const created = (await createResponse.json()) as MediaView | { error?: string };
          if (!createResponse.ok || !("status" in created) || created.status !== "live") {
            setError("error" in created && created.error ? created.error : "Could not save AI draft");
            setView(live);
            void persistMediaSnapshot(view.orgId, String(view.seasonYear), live);
            return false;
          }
          setView(created);
          void persistMediaSnapshot(view.orgId, String(view.seasonYear), created);
          return true;
        }
        if (live.draft?.status === "live") {
          setDraftMeta({ feature: live.draft.feature, generatedAt: live.draft.generatedAt });
        }
        setView(live);
        void persistMediaSnapshot(view.orgId, String(view.seasonYear), live);
        return true;
      } catch {
        setError("Media update failed");
        return false;
      } finally {
        setBusy(false);
      }
    },
    [busy, view],
  );

  const orgId = view && "orgId" in view ? view.orgId : null;
  const kit = view?.status === "live" ? view.kit : null;
  const outreach = view?.status === "live" ? view.outreach : null;
  const impact = view?.status === "live" ? view.impact : null;
  const sponsorWall = view?.status === "live" ? view.sponsorWall : null;
  const items = view?.status === "live" ? view.items : [];

  const shell = classifyMediaShell({
    loading: view == null && !fetchFailed,
    fetchFailed,
    status: view?.status ?? null,
    orgId: view?.status === "live" || view?.status === "setup_required" ? view.orgId : null,
    assetCount: kit?.assetCount,
    documentCount: kit?.documentCount,
    readinessScore: kit?.readinessScore,
    upcomingCount: outreach?.upcomingCount,
    mediaCategoryCount: outreach?.mediaCategoryCount,
    mediaActivityCount: impact?.mediaActivityCount,
    publishedEntryCount: sponsorWall?.publishedEntryCount,
    itemCount: items.length,
  });

  // Live org always gets the TabBar hub so users can create the first draft/schedule.
  if (hubDenied || accessDenied) {
    return (
      <SoftAccessDenied
        breadcrumbs="Media"
        title="Media"
        heading={hubDenied ? "Media is not available" : "This Media tab is not available"}
        description={
          error ||
          "Your team admin limited which Media sections you can open. Ask an owner to update section access under Team → Security."
        }
      />
    );
  }

  if (view?.status === "live") {
    return (
      <LiveMediaWorkspace
        view={view}
        tab={tab}
        onTab={selectTab}
        tabs={visibleTabs}
        busy={busy}
        error={error}
        cutoffCode={cutoffCode}
        draftMeta={draftMeta}
        mutate={mutate}
        banner={<OfflineBanner feature="Media" fromCache={fromCache} cachedAt={cachedAt} />}
      />
    );
  }

  return (
    <MediaShell
      description="Content calendar, drafts, reminders, Media kit, and impact."
      orgId={orgId}
      shell={shell === "ready" ? "empty" : shell}
      error={error || undefined}
      errorStatus={errorStatus}
      onRetry={load}
    >
      <OfflineBanner feature="Media" fromCache={fromCache} cachedAt={cachedAt} />
    </MediaShell>
  );
}
