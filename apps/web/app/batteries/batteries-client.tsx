"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { classifyLoadFailure, loadFailureCopy } from "../../lib/ui/load-failure";
import { batteryNextActions, packHasMeasurement } from "../../lib/battery/battery-related";
import { FEATURE_API_TIMEOUT_MS } from "../../lib/nav/resolve-org";
import {
  QUEUED_ON_DEVICE,
  getFeatureSnapshot,
  isBrowserOffline,
  putFeatureSnapshot,
  queueProductWrite,
  syncOutbox,
} from "../../lib/offline";
import {
  BatteriesLoadShell,
  BatteriesNextActions,
  BatteriesReadyHeader,
  BatteriesSetupShell,
  BatteriesSummary,
} from "./batteries-chrome";
import { BatteriesFleetColumn } from "./batteries-fleet";
import { BatteriesForms } from "./batteries-forms";
import {
  EMPTY_LOG_FORM,
  EMPTY_PACK_FORM,
  batteryRunOkMessage,
  rotationPacksFrom,
  type ActionBody,
  type HubEmbed,
  type LogForm,
  type PackForm,
  type View,
} from "./batteries-model";
import "./batteries.css";

function isBatteriesView(value: unknown): value is View {
  if (!value || typeof value !== "object") return false;
  const status = (value as { status?: unknown }).status;
  return status === "setup_required" || status === "ready";
}

function batteriesCacheOrg(data: View, orgHint: string): string {
  if (data.status === "ready" && data.context.orgId.trim()) return data.context.orgId;
  return orgHint;
}

async function persistBatteriesSnapshot(orgHint: string, data: View): Promise<void> {
  const cacheOrg = batteriesCacheOrg(data, orgHint);
  if (!cacheOrg) return;
  try {
    await putFeatureSnapshot("batteries", cacheOrg, data);
    if (!orgHint) await putFeatureSnapshot("batteries", "_", data);
  } catch {
    // Live Batteries already painted; IndexedDB is best-effort.
  }
}

function useHubEmbed(): HubEmbed | null {
  const [embed, setEmbed] = useState<HubEmbed | null>(null);
  useEffect(() => {
    const path = window.location.pathname;
    if (path.startsWith("/team")) setEmbed("team");
    else if (path.startsWith("/build")) setEmbed("build");
    else setEmbed(null);
  }, []);
  return embed;
}

export default function BatteriesClient({ embedded = false }: { embedded?: boolean } = {}) {
  const pathEmbed = useHubEmbed();
  const embed = pathEmbed ?? (embedded ? "team" : null);
  const [view, setView] = useState<View | null>(null);
  const [error, setError] = useState("");
  const [okMessage, setOkMessage] = useState("");
  const [fetchFailed, setFetchFailed] = useState(false);
  // Kept so an expired session offers sign-in instead of a Retry that cannot work.
  const [errorStatus, setErrorStatus] = useState<number | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [fromCache, setFromCache] = useState(false);
  const [cachedAt, setCachedAt] = useState<string | null>(null);
  const [packForm, setPackForm] = useState<PackForm>(EMPTY_PACK_FORM);
  const [logForm, setLogForm] = useState<LogForm>(EMPTY_LOG_FORM);
  const viewRef = useRef<View | null>(null);
  viewRef.current = view;

  const load = useCallback(async () => {
    const params = new URLSearchParams(typeof window !== "undefined" ? window.location.search : "");
    const orgHint = params.get("orgId")?.trim() ?? "";
    let hadCache = Boolean(viewRef.current);
    try {
      const cached = await getFeatureSnapshot<View>("batteries", orgHint || "_");
      if (!viewRef.current && cached?.data && isBatteriesView(cached.data)) {
        setView(cached.data);
        setFromCache(true);
        setCachedAt(cached.cachedAt);
        hadCache = true;
      }
    } catch {
      // IndexedDB missing or blocked; live fetch still runs.
    }
    setFetchFailed(false);
    setError("");
    setErrorStatus(null);
    try {
      const response = await fetch(
        `/api/batteries${orgHint ? `?orgId=${encodeURIComponent(orgHint)}` : ""}`,
        {
          cache: "no-store",
          signal: AbortSignal.timeout(FEATURE_API_TIMEOUT_MS),
        },
      );
      const data: unknown = await response.json().catch(() => null);
      if (response.status === 401 || response.status === 403) {
        setView(null);
        setFromCache(false);
        setCachedAt(null);
        setFetchFailed(true);
        setErrorStatus(response.status);
        setError(
          data && typeof data === "object" && "error" in data && typeof data.error === "string"
            ? data.error
            : "",
        );
        return;
      }
      if (!response.ok || !isBatteriesView(data)) {
        if (hadCache || viewRef.current) {
          setFromCache(true);
          setError("Could not refresh Batteries. Showing the last copy on this device.");
          setFetchFailed(false);
          return;
        }
        setFetchFailed(true);
        setErrorStatus(response.status);
        setError(
          data && typeof data === "object" && "error" in data && typeof data.error === "string"
            ? data.error
            : "Could not load batteries.",
        );
        return;
      }
      setError("");
      setErrorStatus(null);
      setView(data);
      setFromCache(false);
      setCachedAt(null);
      await persistBatteriesSnapshot(orgHint, data);
      if (data.status === "ready") {
        setLogForm((prev) => {
          if (prev.batteryId && data.packs.some((pack) => pack.id === prev.batteryId)) return prev;
          return { ...prev, batteryId: data.packs[0]?.id ?? "" };
        });
      }
    } catch {
      if (hadCache || viewRef.current) {
        setFromCache(true);
        setError("Could not refresh Batteries. Showing the last copy on this device.");
        setFetchFailed(false);
        return;
      }
      setFetchFailed(true);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const orgId = params.get("orgId") ?? "";
    if (!orgId) return;
    const onOnline = () => {
      void syncOutbox({ orgId }).then(() => load());
    };
    window.addEventListener("online", onOnline);
    return () => window.removeEventListener("online", onOnline);
  }, [load]);

  const run = useCallback(
    async (body: ActionBody, key: string) => {
      if (isBrowserOffline() && (body.action === "log_event" || body.action === "assign_pack") && body.orgId) {
        await queueProductWrite({
          feature: "batteries_action",
          orgId: body.orgId,
          payload: body,
        });
        setError(QUEUED_ON_DEVICE);
        return;
      }
      setBusyKey(key);
      setError("");
      setOkMessage("");
      try {
        const response = await fetch("/api/batteries", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(FEATURE_API_TIMEOUT_MS),
        });
        const data = (await response.json()) as { error?: string };
        if (!response.ok) {
          setError(data.error ?? "Action failed.");
          return;
        }
        setOkMessage(batteryRunOkMessage(body.action));
        await load();
      } catch {
        if (isBrowserOffline() && (body.action === "log_event" || body.action === "assign_pack") && body.orgId) {
          await queueProductWrite({
            feature: "batteries_action",
            orgId: body.orgId,
            payload: body,
          });
          setError(QUEUED_ON_DEVICE);
          return;
        }
        setError("Network error — changes were not saved.");
      } finally {
        setBusyKey(null);
      }
    },
    [load],
  );

  if (!view) {
    const failure = fetchFailed
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
            message: error || "Check your connection and try again.",
          },
        )
      : null;
    return (
      <BatteriesLoadShell
        embed={embed}
        failure={failure}
        onRetry={() => void load()}
        fromCache={fromCache}
        cachedAt={cachedAt}
      />
    );
  }

  if (view.status === "setup_required") {
    return (
      <BatteriesSetupShell
        embed={embed}
        message={view.message}
        fromCache={fromCache}
        cachedAt={cachedAt}
      />
    );
  }

  const orgId = view.context.orgId;
  const busy = busyKey != null;
  const rotationPacks = rotationPacksFrom(view);
  const canDelete = view.context.role === "owner" || view.context.role === "admin";
  const nextActions = batteryNextActions({
    orgId,
    // `BatteryPackSnap.health.score` in lib/battery/battery-related.ts is still
    // `number`, but batteryHealth returns null for an unmeasured pack. The
    // helper never reads `score` (it goes through packHasMeasurement), so this
    // is only a too-narrow declaration — no value is invented here. Handoff:
    // widen that field to `number | null` and this cast goes away.
    packs: view.packs as unknown as Parameters<typeof batteryNextActions>[0]["packs"],
    logCount: view.logs.length,
    nextRotationLabel: rotationPacks[0]?.label ?? null,
  });
  const measuredCount = view.packs.filter((pack) => packHasMeasurement(pack)).length;

  return (
    <main className="module-page batt-page">
      <BatteriesReadyHeader
        embed={embed}
        view={view}
        fromCache={fromCache}
        cachedAt={cachedAt}
        error={error}
        okMessage={okMessage}
        orgId={orgId}
      />
      {view.packs.length > 0 ? <BatteriesNextActions actions={nextActions} ready /> : null}
      <BatteriesSummary view={view} />
      <div className="batt-layout">
        <BatteriesFleetColumn
          view={view}
          orgId={orgId}
          busy={busy}
          canDelete={canDelete}
          measuredCount={measuredCount}
          rotationPacks={rotationPacks}
          run={run}
          onLogIr={(packId) => {
            setLogForm((prev) => ({ ...prev, batteryId: packId, kind: "resistance_test" }));
            document.getElementById("batt-log-form")?.scrollIntoView({ behavior: "smooth", block: "start" });
          }}
        />
        <BatteriesForms
          view={view}
          orgId={orgId}
          busy={busy}
          packForm={packForm}
          setPackForm={setPackForm}
          logForm={logForm}
          setLogForm={setLogForm}
          run={run}
        />
      </div>
    </main>
  );
}
