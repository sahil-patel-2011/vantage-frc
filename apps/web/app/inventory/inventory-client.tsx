"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import { AiInsightPanel } from "../../components/ai-insight-panel";
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
import {
  INVENTORY_ADD_HREF,
  filterVisibleInventoryItems,
  inventoryOrgId,
  type ActionBody,
  type InventoryTab,
} from "./inventory-model";
import { InventoryStockPanel } from "./inventory-stock";

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

  const load = useCallback(async () => {
    setFetchFailed(false);
    setErrorStatus(null);
    setError("");
    const params = new URLSearchParams(window.location.search);
    const orgId = params.get("orgId");
    try {
      const response = await fetch(`/api/inventory${orgId ? `?orgId=${encodeURIComponent(orgId)}` : ""}`, {
        cache: "no-store",
        signal: AbortSignal.timeout(FEATURE_API_TIMEOUT_MS),
      });
      const data = (await response.json()) as InventoryView | { error?: string };
      if (!response.ok || !("status" in data)) {
        setError("error" in data && data.error ? data.error : "Could not load inventory.");
        setErrorStatus(response.status);
        setFetchFailed(true);
        return;
      }
      setView(data);
    } catch {
      setFetchFailed(true);
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
    return <InventoryShell description={shellCopy.description} orgId={null} shell="loading" />;
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
      />
    );
  }

  if (shell === "setup" || view?.status !== "ready") {
    return (
      <InventoryShell
        description={view?.status === "setup_required" ? view.message : shellCopy.description}
        orgId={orgId}
        shell="setup"
      />
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
