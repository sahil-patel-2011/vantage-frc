"use client";

import { Fragment, isValidElement, type ReactNode } from "react";
import type { ProductHubDef } from "../../lib/nav/hubs";
import { EmptyState } from "./empty-state";
import { PageHeader } from "./page-header";
import { Shell, type ShellState } from "./shell";
import { SoftBlockSkeleton } from "./skeleton";
import { toolPageBreadcrumb, type ToolPageCrumb } from "./tool-page-breadcrumb";

export type ToolPageError = {
  title?: ReactNode;
  /** The REAL failure text (API body / error.message) — ErrorState classifies it. */
  message?: ReactNode;
  /** HTTP status from the failed request, when the caller kept it. */
  status?: number | null;
};

/** Setup-required copy; rendered as the standard soft EmptyState with a "Setup required" badge. */
export type ToolPageSetup = {
  badge?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  /** CTA links / setup steps. */
  children?: ReactNode;
};

type ToolPageProps = {
  /** Hub the tool belongs to — the breadcrumb links back to its workbench. */
  hub: ProductHubDef["id"];
  /** The tool's tab id in lib/nav/hubs (e.g. "cad-vault"). */
  hubTab: string;
  title: ReactNode;
  description?: ReactNode;
  state: ShellState;
  error?: ToolPageError | string | null;
  onRetry?: () => void;
  /** Setup copy, or a fully custom node (steps list, next actions…). */
  setup?: ToolPageSetup | ReactNode;
  empty?: ReactNode;
  filteredEmpty?: ReactNode;
  /** Layout-matched skeleton; defaults to SoftBlockSkeleton. */
  loading?: ReactNode;
  /** Trailing header actions (season select, related links, badges). */
  actions?: ReactNode;
  orgId?: string | null;
  /** Overrides the hub tab label in the breadcrumb. */
  toolLabel?: string;
  /**
   * Rendered inside a ProductHubShell panel: no <main>, no title/breadcrumb (the
   * hub owns them) — only the action row survives, matching product-hub.css.
   */
  embedded?: boolean;
  /** Page-scoped class (e.g. "cad-vault-page") for the module stylesheet. */
  className?: string;
  /** The live view — rendered only when state === "ready". Omit for a pure shell (setup / error pages). */
  children?: ReactNode;
};

/** `Hub / Tool` crumb trail; the hub crumb is a link back to the owning workbench. */
export function ToolPageBreadcrumbs({ crumbs }: { crumbs: ToolPageCrumb[] }) {
  return (
    <>
      {crumbs.map((crumb, index) => (
        <Fragment key={`${index}-${crumb.label}`}>
          {index > 0 ? " / " : null}
          {crumb.href ? <a href={crumb.href}>{crumb.label}</a> : crumb.label}
        </Fragment>
      ))}
    </>
  );
}

function isSetupCopy(value: ToolPageProps["setup"]): value is ToolPageSetup {
  return (
    typeof value === "object" &&
    value !== null &&
    !isValidElement(value) &&
    !Array.isArray(value) &&
    "title" in value
  );
}

/**
 * The one leaf-page skeleton: PageHeader with a hub breadcrumb, then the module's
 * state mapped through <Shell> — loading → skeleton, error → ErrorState with the
 * real message and Retry, setup → "Setup required" EmptyState, ready → children.
 *
 * Pages keep their panels and handlers and only hand this the outer chrome, so
 * every tool reads the same way from Build, Team, Competition, or Business.
 */
export function ToolPage({
  hub,
  hubTab,
  title,
  description,
  state,
  error,
  onRetry,
  setup,
  empty,
  filteredEmpty,
  loading,
  actions,
  orgId,
  toolLabel,
  embedded = false,
  className,
  children,
}: ToolPageProps) {
  const crumbs = toolPageBreadcrumb(hub, hubTab, { orgId, toolLabel });
  const failure = typeof error === "string" ? { message: error } : (error ?? undefined);
  const setupNode = isSetupCopy(setup) ? (
    <EmptyState
      soft
      badge={setup.badge ?? "Setup required"}
      badgeTone="setup"
      title={setup.title}
      description={setup.description}
    >
      {setup.children}
    </EmptyState>
  ) : (
    (setup as ReactNode | undefined)
  );
  const Root = embedded ? "div" : "main";
  const rootClass = [
    embedded ? undefined : "module-page",
    "tool-page",
    className,
    state === "setup" ? "soft-gate" : undefined,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <Root className={rootClass} data-tool-state={state} data-tool-hub={hub} data-tool-tab={hubTab}>
      {embedded ? (
        actions ? <div className="app-page-header tool-page-actions">{actions}</div> : null
      ) : (
        <PageHeader breadcrumbs={<ToolPageBreadcrumbs crumbs={crumbs} />} title={title} description={description}>
          {actions}
        </PageHeader>
      )}
      <Shell
        state={state}
        loading={loading ?? <SoftBlockSkeleton lines={4} />}
        error={{ title: failure?.title, message: failure?.message, status: failure?.status, onRetry }}
        setup={setupNode}
        empty={empty}
        filteredEmpty={filteredEmpty}
      >
        {children}
      </Shell>
    </Root>
  );
}
