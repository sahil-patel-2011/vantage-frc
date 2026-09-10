"use client";

import { useCallback, useEffect, useState } from "react";
import { OfflineBanner } from "../../components/offline-banner";
import { LogisticsRelated } from "../../components/logistics-related";
import { PageHeader } from "../../components/ui";
import { TeamOpsNav } from "../../components/team-ops-nav";
import { getFeatureSnapshot, putFeatureSnapshot, useOnline } from "../../lib/offline";
import {
  checklistProgress,
  filterChecklistForViewer,
  type ChecklistItem,
  type LogisticsView,
} from "../../lib/logistics";
import {
  LOGISTICS_RELATED_INCLUDE,
  classifyLogisticsShell,
  formatLodgingClarity,
  logisticsShellNextActions,
} from "../../lib/logistics/logistics-related";
import { LogisticsNextActionsPanel, LogisticsShell } from "./logistics-chrome";
import { LogisticsDayPanel } from "./logistics-day";
import { LogisticsManagePanel } from "./logistics-manage";
import { FEATURE_API_TIMEOUT_MS } from "../../lib/nav/resolve-org";
import { canActOnline, type ActionBody } from "./logistics-model";
import { LogisticsTripsPanel } from "./logistics-trips";

export default function LogisticsClient() {
  const online = useOnline();
  const [view, setView] = useState<LogisticsView | null>(null);
  const [error, setError] = useState("");
  const [okMessage, setOkMessage] = useState("");
  const [fromCache, setFromCache] = useState(false);
  const [cachedAt, setCachedAt] = useState<string | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [selectedTripId, setSelectedTripId] = useState<string | null>(null);
  const [fetchFailed, setFetchFailed] = useState(false);

  const load = useCallback(async () => {
    setError("");
    const params = new URLSearchParams(window.location.search);
    const orgId = params.get("orgId") ?? "";
    const qs = orgId ? `?orgId=${encodeURIComponent(orgId)}` : "";
    const cached = await getFeatureSnapshot<LogisticsView>("logistics", orgId);
    if (cached?.data) {
      setView(cached.data);
      setFromCache(true);
      setCachedAt(cached.cachedAt);
    }
    try {
      const response = await fetch(`/api/logistics${qs}`, {
        cache: "no-store",
        signal: AbortSignal.timeout(FEATURE_API_TIMEOUT_MS),
      });
      const data = (await response.json()) as LogisticsView & { error?: string };
      if (!response.ok) throw new Error(data.error ?? "Could not load logistics");
      setView(data);
      setFromCache(false);
      setCachedAt(null);
      setFetchFailed(false);
      const cacheOrg = data.status === "ready" ? data.context.orgId : orgId;
      if (cacheOrg) await putFeatureSnapshot("logistics", cacheOrg, data);
      if (data.status === "ready") {
        setSelectedTripId((prev) => {
          if (prev && data.trips.some((t) => t.id === prev)) return prev;
          return data.trips[0]?.id ?? null;
        });
      }
    } catch (err: unknown) {
      if (!cached) {
        setFetchFailed(true);
        setError(err instanceof Error ? err.message : "Could not load logistics");
      }
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const run = useCallback(
    async (body: ActionBody, key: string) => {
      if (!canActOnline(online, fromCache)) {
        setError("Reconnect to save changes (cached copy is read-only).");
        return;
      }
      setBusyKey(key);
      setError("");
      setOkMessage("");
      try {
        const response = await fetch("/api/logistics", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        });
        const data = (await response.json()) as LogisticsView & { error?: string };
        if (!response.ok) {
          setError(data.error ?? "Could not save");
          return;
        }
        if ("status" in data) {
          setView(data);
          setFromCache(false);
          setCachedAt(null);
          if (data.status === "ready") {
            await putFeatureSnapshot("logistics", data.context.orgId, data);
            setSelectedTripId((prev) => {
              if (prev && data.trips.some((t) => t.id === prev)) return prev;
              return data.trips[0]?.id ?? null;
            });
          }
        } else {
          await load();
        }
        setOkMessage("Saved.");
      } catch {
        setError("Network error — changes were not saved.");
      } finally {
        setBusyKey(null);
      }
    },
    [fromCache, load, online],
  );

  const orgIdParam = view?.status === "ready" ? view.context.orgId : view?.context?.orgId ?? null;
  const urlOrg =
    typeof window !== "undefined" ? new URLSearchParams(window.location.search).get("orgId") : null;

  if (error && !view) {
    return (
      <LogisticsShell
        orgId={urlOrg}
        shell="error"
        error={error}
        onRetry={() => {
          setFetchFailed(false);
          void load();
        }}
      >
        <OfflineBanner
          feature="Logistics"
          fromCache={false}
          detail={!online ? "Open once online to cache trip info." : undefined}
        />
      </LogisticsShell>
    );
  }

  if (!view) {
    return (
      <LogisticsShell
        orgId={urlOrg}
        shell={classifyLogisticsShell({ loading: !fetchFailed, fetchFailed })}
      />
    );
  }

  if (view.status === "setup_required") {
    return (
      <LogisticsShell
        orgId={orgIdParam}
        shell="setup"
        error={view.message}
      >
        <OfflineBanner feature="Logistics" fromCache={fromCache} cachedAt={cachedAt} />
      </LogisticsShell>
    );
  }

  const ready = view;
  const {
    context,
    trips,
    sharedChecklist,
    contacts,
    members,
    myLodging,
    myTrip,
    nextLeg,
    lodgingGaps,
    activeOnDuty,
  } = ready;
  const orgId = context.orgId;
  const canManage = context.canManage;
  const trip = trips.find((t) => t.id === selectedTripId) ?? trips[0] ?? null;
  const legs = trip?.travelLegs ?? [];
  const viewerChecklist = filterChecklistForViewer(sharedChecklist, context.teamRole);
  const checklistStats = checklistProgress(viewerChecklist);
  const busy = busyKey != null;
  const act = canActOnline(online, fromCache);
  const hasPlan = trips.length > 0;
  const hotelCount = trips.reduce((n, t) => n + t.hotels.length, 0);
  const travelLegCount = trips.reduce((n, t) => n + t.travelLegs.length, 0);
  const lodgingLine = formatLodgingClarity({
    hotelName: myLodging?.hotelName,
    roomLabel: myLodging?.roomLabel,
  });
  const readyActions = logisticsShellNextActions({
    orgId,
    shell: hasPlan ? "ready" : "empty",
    canManage,
    lodgingGaps,
    hotelCount,
    travelLegCount,
  });

  if (!hasPlan) {
    return (
      <LogisticsShell orgId={orgId} shell="empty" canManage={canManage}>
        <OfflineBanner
          feature="Logistics"
          fromCache={fromCache}
          cachedAt={cachedAt}
          detail={!online ? "Showing cached logistics from this device." : undefined}
        />
      </LogisticsShell>
    );
  }

  const toggleChecklist = (item: ChecklistItem, checked: boolean) => {
    void run({ action: "toggle_checklist", orgId, id: item.id, checked }, `chk:${item.id}`);
  };

  return (
    <main className="log-page">
      <PageHeader
        navPath="/logistics"
        title="Logistics"
        description={
          canManage
            ? `${context.orgName ?? "Team"} — plan hotels, travel legs, contacts, and day-of checklists.`
            : `${context.orgName ?? "Team"} — your lodging, leave times, who to call, and day-of checklist.`
        }
      >
        <LogisticsRelated orgId={orgId} include={[...LOGISTICS_RELATED_INCLUDE]} />
      </PageHeader>
      <TeamOpsNav orgId={orgId} active="logistics" />
      <OfflineBanner
        feature="Logistics"
        fromCache={fromCache}
        cachedAt={cachedAt}
        detail={!online ? "Showing cached logistics from this device." : undefined}
      />
      {error ? <p className="log-banner error">{error}</p> : null}
      {okMessage ? <p className="log-banner ok">{okMessage}</p> : null}

      <LogisticsNextActionsPanel actions={readyActions} />
      <LogisticsDayPanel
        canManage={canManage}
        nextLeg={nextLeg}
        myTrip={myTrip ?? []}
        myLodging={myLodging}
        lodgingLine={lodgingLine}
        activeOnDuty={activeOnDuty}
        viewerChecklist={viewerChecklist}
        checklistStats={checklistStats}
        contacts={contacts}
        act={act}
        busy={busy}
        onToggleChecklist={toggleChecklist}
      />
      <LogisticsManagePanel
        orgId={orgId}
        canManage={canManage}
        trips={trips}
        trip={trip}
        sharedChecklist={sharedChecklist}
        contacts={contacts}
        members={members}
        activeOnDuty={activeOnDuty}
        lodgingGaps={lodgingGaps}
        act={act}
        busy={busy}
        run={run}
      />
      <LogisticsTripsPanel
        orgId={orgId}
        canManage={canManage}
        trips={trips}
        trip={trip}
        legs={legs}
        members={members}
        act={act}
        busy={busy}
        run={run}
        onSelectTrip={setSelectedTripId}
      />
    </main>
  );
}
