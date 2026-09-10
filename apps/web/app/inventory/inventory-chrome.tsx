"use client";

import { type ReactNode } from "react";
import { Button, EmptyState, PageHeader, Panel, ToolStrip } from "../../components/ui";
import { ActionMenu, type ActionSpec } from "../../components/ui/action-menu";
import { withOrgHref } from "../../lib/nav/product-nav";
import { classifyLoadFailure, loadFailureCopy } from "../../lib/ui/load-failure";
import {
  INVENTORY_RELATED_INCLUDE,
  formatInventoryMetric,
  formatInventoryMoney,
  inventoryCardPrimaryHref,
  inventoryRelatedLinks,
  inventoryShellCopy,
  type InventoryNextAction,
  type InventoryShellKind,
} from "../../lib/inventory/inventory-related";
import {
  INVENTORY_ADD_HREF,
  INVENTORY_SECTION_ITEMS,
  inventorySectionDescribe,
  parseInventoryTab,
  type InventoryTab,
} from "./inventory-model";

export function InventoryRelatedStrip({ orgId }: { orgId?: string | null }) {
  const links = inventoryRelatedLinks(orgId, {
    include: [...INVENTORY_RELATED_INCLUDE],
  });
  if (!links.length) return null;
  return (
    <nav className="product-hub-related inventory-related" aria-label="Related inventory tools">
      {links.map((link) => (
        <Button as="a" variant="secondary" key={link.id} href={link.href}>
          {link.label}
        </Button>
      ))}
    </nav>
  );
}

export function InventoryNextActionsPanel({ actions }: { actions: InventoryNextAction[] }) {
  if (!actions.length) return null;
  return (
    <section className="app-card soft-panel edc-next-actions inventory-next-actions" aria-label="Next actions">
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

export function InventoryShell({
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
  shell: InventoryShellKind;
  error?: string;
  errorStatus?: number | null;
  onRetry?: () => void;
  children?: ReactNode;
}) {
  const copy = inventoryShellCopy(shell);
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
  const buildHref = withOrgHref("/build", orgId);

  return (
    <main className="module-page inventory-page soft-gate">
      <PageHeader
        breadcrumbs={
          <>
            <a href={buildHref}>Build</a>
            {" / Inventory"}
          </>
        }
        title="Inventory & BOM"
        description={description}
      >
        <InventoryRelatedStrip orgId={orgId} />
      </PageHeader>
      {children}
      <EmptyState
        soft
        badge={
          shell === "setup"
            ? "Setup required"
            : shell === "error"
              ? "Unavailable"
              : shell === "empty"
                ? "No parts yet"
                : copy.badge
        }
        badgeTone="setup"
        title={failure && failure.kind !== "unknown" ? failure.title : copy.title}
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
          <Button as="a" variant="primary" href={inventoryCardPrimaryHref(orgId)}>
            Choose your team
          </Button>
        ) : null}
        {shell === "empty" ? (
          <Button as="a" variant="primary" href={INVENTORY_ADD_HREF}>
            Add a part
          </Button>
        ) : null}
      </EmptyState>
    </main>
  );
}

export function SummaryTiles({
  totalItems,
  lowStock,
  outOfStock,
  value,
}: {
  totalItems: number;
  lowStock: number;
  outOfStock: number;
  value: number;
}) {
  const tiles = [
    { label: "Tracked items", value: formatInventoryMetric(totalItems, true) },
    { label: "At / below reorder", value: formatInventoryMetric(lowStock, true), warn: lowStock > 0 },
    { label: "Out of stock", value: formatInventoryMetric(outOfStock, true), warn: outOfStock > 0 },
    { label: "On-hand value", value: formatInventoryMoney(value, true) },
  ];
  return (
    <section className="inventory-stats" aria-label="Real inventory counts">
      {tiles.map((tile) => (
        <div key={tile.label} className={tile.warn ? "warn" : undefined}>
          <strong>{tile.value}</strong>
          <span className="app-muted" style={{ display: "block" }}>
            {tile.label}
          </span>
        </div>
      ))}
    </section>
  );
}

export function InventoryReadyHeader({
  orgId,
  orgName,
  teamNumber,
  lowStock,
  shell,
  showAdd,
  onToggleAdd,
  onToggleLabels,
}: {
  orgId: string;
  orgName: string | null;
  teamNumber: number | null;
  lowStock: number;
  shell: InventoryShellKind;
  showAdd: boolean;
  onToggleAdd: () => void;
  onToggleLabels: () => void;
}) {
  const buildHref = withOrgHref("/build", orgId);
  const actions: ActionSpec[] = [];
  if (shell !== "empty") {
    actions.push({
      id: "add-item",
      label: showAdd ? "Close add item" : "Add item",
      intent: "primary",
      onClick: onToggleAdd,
    });
  }
  actions.push({
    id: "labels",
    label: "Scan / labels",
    hint: "Print or scan location + item labels",
    onClick: onToggleLabels,
  });

  return (
    <PageHeader
      breadcrumbs={
        <>
          <a href={buildHref}>Build</a>
          {" / Inventory"}
        </>
      }
      title="Inventory & BOM"
      description={`Parts & materials stock, storage locations, and per-mechanism bills of materials for ${orgName ?? "your team"}${teamNumber ? ` (Team ${teamNumber})` : ""}. Cross-check Vendors, Orders, and Spare Forecast.`}
    >
      <div className="inventory-header-actions">
        {lowStock > 0 ? (
          <span className="app-badge setup">{formatInventoryMetric(lowStock, true)} low</span>
        ) : null}
        <InventoryRelatedStrip orgId={orgId} />
        {shell === "empty" ? (
          <Button type="button" variant="secondary" onClick={onToggleLabels}>
            Scan / labels
          </Button>
        ) : (
          <ActionMenu label="Inventory" overflowLabel="Related tools" maxSecondary={1} actions={actions} />
        )}
      </div>
    </PageHeader>
  );
}

export function InventoryEmptyCard({ onAdd }: { onAdd: () => void }) {
  const copy = inventoryShellCopy("empty");
  return (
    <EmptyState
      soft
      badge="No parts yet"
      badgeTone="setup"
      title={copy.title}
      description={copy.description}
    >
      <Button type="button" variant="primary" onClick={onAdd}>
        Add a part
      </Button>
    </EmptyState>
  );
}

export function InventorySectionStrip({
  tab,
  onTab,
}: {
  tab: InventoryTab;
  onTab: (tab: InventoryTab) => void;
}) {
  return (
    <ToolStrip
      aria-label="Inventory sections"
      value={tab}
      onChange={(id) => {
        const next = parseInventoryTab(id);
        if (next) onTab(next);
      }}
      items={INVENTORY_SECTION_ITEMS}
      describe={(id) => {
        const next = parseInventoryTab(id);
        return next ? inventorySectionDescribe(next) : undefined;
      }}
    />
  );
}

export function InventoryTipPanel() {
  return (
    <Panel className="inventory-tip" aria-label="Inventory tip">
      <span className="eyebrow">Procurement path</span>
      {/* Prose, not a third set of buttons. Orders, Vendors and Spare Forecast
          each had a link here *and* a row in Next actions above — two controls
          for the same destination, the lower one with no reason attached. The
          panel keeps the sentence and gives up the links. */}
      <p className="app-muted" style={{ marginTop: 8 }}>
        Restock through Orders, keep suppliers in Vendors, and project spare exhaustion in Spare
        Forecast.
      </p>
    </Panel>
  );
}
