"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { AiInsightPanel } from "../../components/ai-insight-panel";
import { OfflineBanner } from "../../components/offline-banner";
import {
  summarizeInventory,
  type InventoryView,
} from "../../lib/inventory";
import {
  classifyInventoryShell,
  inventoryNextActions,
  inventoryShellCopy,
  shouldShowInventorySummaryTiles,
} from "../../lib/inventory/inventory-related";
import {
  InventoryEmptyCard,
  InventoryNextActionsPanel,
  InventoryReadyHeader,
  InventorySectionStrip,
  InventoryShell,
  InventoryTipPanel,
  SummaryTiles,
} from "./inventory-chrome";
import { AddItemForm } from "./inventory-items";
import InventoryLabelTools from "./inventory-label-tools";
import { LocationsPanel } from "./inventory-locations";
import { BomPanel } from "./inventory-bom";
import { FEATURE_API_TIMEOUT_MS } from "../../lib/nav/resolve-org";
import { getFeatureSnapshot, putFeatureSnapshot } from "../../lib/offline/feature-cache";
import {
  INVENTORY_ADD_HREF,
  filterVisibleInventoryItems,
  inventoryOrgId,
  type ActionBody,
  type InventoryTab,
} from "./inventory-model";
import { InventoryStockPanel } from "./inventory-stock";

function isInventoryView(value: unknown): value is InventoryView {
  if (!value || typeof value !== "object") return false;
  const status = (value as { status?: unknown }).status;
  return status === "ready" || status === "setup_required";
}

async function persistInventorySnapshot(orgHint: string, data: InventoryView): Promise<void> {
  const cacheOrg = inventoryOrgId(data) || orgHint;
  if (!cacheOrg) return;
  try {
    await putFeatureSnapshot("inventory", cacheOrg, data);
    if (!orgHint) await putFeatureSnapshot("inventory", "_", data);
  } catch {
    // Live inventory already painted; IndexedDB is best-effort.
  }
}

export default function InventoryClient() {
  const [view, setView] = useState<InventoryView | null>(null);
  const [error, setError] = useState("");
  const [fetchFailed, setFetchFailed] = useState(false);
  // Kept so an expired session offers sign-in instead of a Retry that cannot work.
  const [errorStatus, setErrorStatus] = useState<number | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [tab, setTab] = useState<InventoryTab>("stock");
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("all");
  const [lowOnly, setLowOnly] = useState(false);
  const [sparesOnly, setSparesOnly] = useState(false);
  const [showArchived, setShowArchived] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  const [showLabels, setShowLabels] = useState(false);
  const [fromCache, setFromCache] = useState(false);
  const [cachedAt, setCachedAt] = useState<string | null>(null);
  const viewRef = useRef<InventoryView | null>(null);
  viewRef.current = view;

  const load = useCallback(async () => {
    const params = new URLSearchParams(window.location.search);
    const urlOrg = params.get("orgId")?.trim() ?? "";
    let hadCache = Boolean(viewRef.current);
    try {
      const cached = await getFeatureSnapshot<InventoryView>("inventory", urlOrg || "_");
      if (!viewRef.current && cached?.data && isInventoryView(cached.data)) {
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
    setError("");
    try {
      const response = await fetch(`/api/inventory${urlOrg ? `?orgId=${encodeURIComponent(urlOrg)}` : ""}`, {
        cache: "no-store",
        signal: AbortSignal.timeout(FEATURE_API_TIMEOUT_MS),
      });
      const data = (await response.json()) as InventoryView | { error?: string };
      if (!response.ok || !isInventoryView(data)) {
        if (hadCache || viewRef.current) {
          setFromCache(true);
          setError("Could not refresh inventory. Showing the last copy on this device.");
          setFetchFailed(false);
        } else {
          setError("error" in data && data.error ? data.error : "Could not load inventory.");
          setErrorStatus(response.status);
          setFetchFailed(true);
        }
        return;
      }
      setView(data);
      setFromCache(false);
      setCachedAt(null);
      await persistInventorySnapshot(urlOrg, data);
    } catch {
      if (hadCache || viewRef.current) {
        setFromCache(true);
        setError("Could not refresh inventory. Showing the last copy on this device.");
        setFetchFailed(false);
      } else {
        setFetchFailed(true);
      }
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const run = useCallback(
    async (body: ActionBody, key: string) => {
      setBusyKey(key);
      setError("");
      try {
        const response = await fetch("/api/inventory", {
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
        if (body.action === "create_item") setShowAdd(false);
        await load();
      } catch {
        setError("Network error — changes were not saved.");
      } finally {
        setBusyKey(null);
      }
    },
    [load],
  );

  const orgId = inventoryOrgId(view);
  const itemCount = view?.status === "ready" ? view.items.filter((item) => !item.archived).length : 0;
  const summary = view?.status === "ready" ? summarizeInventory(view.items) : null;

  const shell = classifyInventoryShell({
    loading: view == null && !fetchFailed,
    fetchFailed,
    status: view?.status ?? null,
    orgId,
    itemCount,
  });
  const shellCopy = inventoryShellCopy(shell);
  const nextActions = inventoryNextActions({
    orgId,
    shell,
    itemCount,
    lowStockCount: summary?.lowStock ?? 0,
    outOfStockCount: summary?.outOfStock ?? 0,
  }).filter((action) => (shell === "empty" ? action.href !== INVENTORY_ADD_HREF : true));

  if (shell === "loading") {
    return (
      <InventoryShell description={shellCopy.description} orgId={null} shell="loading">
        <OfflineBanner feature="Inventory" fromCache={fromCache} cachedAt={cachedAt} />
      </InventoryShell>
    );
  }

  if (shell === "error") {
    return (
      <InventoryShell
        description={shellCopy.description}
        orgId={orgId}
        shell="error"
        error={error || shellCopy.description}
        errorStatus={errorStatus}
        onRetry={() => void load()}
      >
        <OfflineBanner feature="Inventory" fromCache={fromCache} cachedAt={cachedAt} />
      </InventoryShell>
    );
  }

  if (shell === "setup" || view?.status !== "ready") {
    return (
      <InventoryShell
        description={view?.status === "setup_required" ? view.message : shellCopy.description}
        orgId={orgId}
        shell="setup"
      >
        <OfflineBanner feature="Inventory" fromCache={fromCache} cachedAt={cachedAt} />
      </InventoryShell>
    );
  }

  const { context, items, locations } = view;
  const readyOrgId = context.orgId ?? "";
  const visibleItems = filterVisibleInventoryItems(items, {
    search,
    category,
    lowOnly,
    sparesOnly,
    showArchived,
  });

  let section: ReactNode;
  switch (tab) {
    case "stock":
      section = (
        <InventoryStockPanel
          items={items}
          visibleItems={visibleItems}
          locations={locations}
          orgId={readyOrgId}
          busyKey={busyKey}
          run={run}
          search={search}
          category={category}
          lowOnly={lowOnly}
          sparesOnly={sparesOnly}
          showArchived={showArchived}
          onSearch={setSearch}
          onCategory={setCategory}
          onLowOnly={setLowOnly}
          onSparesOnly={setSparesOnly}
          onShowArchived={setShowArchived}
        />
      );
      break;
    case "locations":
      section = <LocationsPanel view={view} orgId={readyOrgId} busyKey={busyKey} run={run} />;
      break;
    case "bom":
      section = <BomPanel view={view} orgId={readyOrgId} busyKey={busyKey} run={run} />;
      break;
    default: {
      const _never: never = tab;
      section = _never;
    }
  }

  return (
    <main className="module-page inventory-page">
      <InventoryReadyHeader
        orgId={readyOrgId}
        orgName={context.orgName}
        teamNumber={context.teamNumber}
        lowStock={summary?.lowStock ?? 0}
        shell={shell}
        showAdd={showAdd}
        onToggleAdd={() => setShowAdd((value) => !value)}
        onToggleLabels={() => setShowLabels((value) => !value)}
      />

      <OfflineBanner feature="Inventory" fromCache={fromCache} cachedAt={cachedAt} />

      {error ? (
        <p className="telemetry-status" role="alert">
          {error}
        </p>
      ) : null}

      <InventoryNextActionsPanel actions={nextActions} />

      {summary && shouldShowInventorySummaryTiles(summary.totalItems) ? (
        <SummaryTiles
          totalItems={summary.totalItems}
          lowStock={summary.lowStock}
          outOfStock={summary.outOfStock}
          value={summary.value}
        />
      ) : null}

      {shell === "empty" ? <InventoryEmptyCard onAdd={() => setShowAdd(true)} /> : null}

      {showAdd ? (
        <AddItemForm
          orgId={readyOrgId}
          locations={locations}
          busy={busyKey === "create-item"}
          onCreate={(body) => void run(body, "create-item")}
          onClose={() => setShowAdd(false)}
        />
      ) : null}

      {showLabels ? (
        <InventoryLabelTools
          orgId={readyOrgId}
          locations={locations}
          onClose={() => setShowLabels(false)}
          onLocate={(location) => {
            setSearch(location.name);
            setCategory("all");
            setLowOnly(false);
            setShowArchived(false);
            setTab("stock");
          }}
        />
      ) : null}

      <InventorySectionStrip tab={tab} onTab={setTab} />
      {section}

      <InventoryTipPanel />

      <AiInsightPanel
        orgId={readyOrgId}
        kind="stock_advisor"
        title="Stock advisor"
        description="Reorder brief from low-stock thresholds and BOM shortfalls — what to buy before build hours are lost."
      />
    </main>
  );
}
