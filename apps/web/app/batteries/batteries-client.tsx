"use client";

import { useCallback, useEffect, useState } from "react";
import { classifyLoadFailure, loadFailureCopy } from "../../lib/ui/load-failure";
import { batteryNextActions, packHasMeasurement } from "../../lib/battery/battery-related";
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

  const load = useCallback(async () => {
    setFetchFailed(false);
    const params = new URLSearchParams(typeof window !== "undefined" ? window.location.search : "");
    const orgId = params.get("orgId") ?? "";
    const cached = orgId ? await getFeatureSnapshot<View>("batteries", orgId) : null;
    if (cached?.data) {
      setView(cached.data);
      setFromCache(true);
      setCachedAt(cached.cachedAt);
    }
    try {
      const response = await fetch(`/api/batteries${orgId ? `?orgId=${encodeURIComponent(orgId)}` : ""}`);
      const data = (await response.json()) as View & { error?: string };
      if (!response.ok || !("status" in data)) {
        setError(data.error ?? "Could not load batteries.");
        setErrorStatus(response.status);
        if (!cached) setFetchFailed(true);
        return;
      }
      setError("");
      setErrorStatus(null);
      setView(data);
      setFromCache(false);
      setCachedAt(null);
      const cacheOrg = data.status === "ready" ? data.context.orgId || orgId : orgId;
      if (cacheOrg) await putFeatureSnapshot("batteries", cacheOrg, data);
      if (data.status === "ready") {
        setLogForm((prev) => {
          if (prev.batteryId && data.packs.some((pack) => pack.id === prev.batteryId)) return prev;
          return { ...prev, batteryId: data.packs[0]?.id ?? "" };
        });
      }
    } catch {
      setErrorStatus(null);
      if (!cached) setFetchFailed(true);
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

  if (fetchFailed || !view) {
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
    return <BatteriesLoadShell embed={embed} failure={failure} onRetry={() => void load()} />;
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
