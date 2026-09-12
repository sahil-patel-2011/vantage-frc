"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { OfflineBanner } from "../../components/offline-banner";
import {
  Badge,
  type BadgeTone,
  EmptyState,
  ErrorState,
  FormGrid,
  FormRow,
  PageHeader,
  Panel,
  SoftBlockSkeleton,
  StatTile, Button } from "../../components/ui";
import { toolCategoryLabel } from "../../lib/tool-checkout";
import { TOOL_CATEGORIES } from "../../lib/tool-checkout/compute-tool-checkout";
import type { ToolCheckoutView } from "../../lib/tool-checkout/compute-tool-checkout";
import type {
  ToolCategory,
  ToolCheckoutMemberOption,
  ToolCheckoutStatus,
  ToolRequiredSkill,
} from "../../lib/tool-checkout/types";
import {
  TOOL_CHECKOUT_RELATED_INCLUDE,
  classifyToolCheckoutShell,
  formatToolCheckoutMetric,
  toolCheckoutNextActions,
  toolCheckoutRelatedLinks,
  toolCheckoutSetupSteps,
  toolCheckoutShellCopy,
  shouldShowToolCheckoutSummaryTiles,
  type ToolCheckoutNextAction,
  type ToolCheckoutShellKind,
} from "../../lib/tool-checkout/tool-checkout-related";
import { hubHref, hubWorkbenchHref } from "../../lib/nav/hubs";
import { FEATURE_API_TIMEOUT_MS } from "../../lib/nav/resolve-org";
import { getFeatureSnapshot, putFeatureSnapshot, clearFeatureSnapshot } from "../../lib/offline/feature-cache";
import "./tool-checkout.css";

type LiveView = Extract<ToolCheckoutView, { status: "live" }>;

const STATUS_LABEL: Record<ToolCheckoutStatus, string> = {
  available: "Available",
  checked_out: "Checked out",
  overdue: "Overdue",
};

const STATUS_TONE: Record<ToolCheckoutStatus, BadgeTone> = {
  available: "good",
  checked_out: "setup",
  overdue: "danger",
};

function isToolCheckoutView(value: unknown): value is ToolCheckoutView {
  if (!value || typeof value !== "object") return false;
  const status = (value as { status?: unknown }).status;
  return status === "setup_required" || status === "live";
}

function toolCheckoutCacheOrg(data: ToolCheckoutView, orgHint: string): string {
  if (typeof data.orgId === "string" && data.orgId.trim()) return data.orgId;
  return orgHint;
}

async function persistToolCheckoutSnapshot(orgHint: string, data: ToolCheckoutView): Promise<void> {
  const cacheOrg = toolCheckoutCacheOrg(data, orgHint);
  if (!cacheOrg) return;
  try {
    await putFeatureSnapshot("tool-checkout", cacheOrg, data);
    if (!orgHint) await putFeatureSnapshot("tool-checkout", "_", data);
  } catch {
    // Live Tool checkout already painted; IndexedDB is best-effort.
  }
}

function RelatedStrip({ orgId }: { orgId?: string | null }) {
  const links = toolCheckoutRelatedLinks(orgId, {
    include: [...TOOL_CHECKOUT_RELATED_INCLUDE],
  });
  if (!links.length) return null;
  return (
    <nav className="product-hub-related tc-related" aria-label="Related team tools">
      {links.map((link) => (
        <Button as="a" variant="secondary" key={link.id} href={link.href}>
          {link.label}
        </Button>
      ))}
    </nav>
  );
}

function NextActionsPanel({ actions }: { actions: ToolCheckoutNextAction[] }) {
  if (!actions.length) return null;
  return (
    <section className="app-card soft-panel edc-next-actions tc-next-actions" aria-label="Next actions">
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

function CheckoutShell({
  description,
  orgId,
  shell,
  error,
  onRetry,
  fromCache = false,
  cachedAt = null,
}: {
  description: string;
  orgId?: string | null;
  shell: ToolCheckoutShellKind;
  error?: string;
  onRetry?: () => void;
  fromCache?: boolean;
  cachedAt?: string | null;
}) {
  const actions = toolCheckoutNextActions({ orgId, shell });
  const copy = toolCheckoutShellCopy(shell);
  const teamHref = hubWorkbenchHref("team", "tool-checkout", orgId);
  const setup = shell === "setup" ? toolCheckoutSetupSteps(orgId)[0] : null;

  return (
    <main className="module-page tc-page soft-gate">
      <PageHeader
        breadcrumbs={
          <>
            <a href={teamHref}>Team</a>
            {" / Tool checkout"}
          </>
        }
        title="Tool checkout"
        description={description}
      >
        <RelatedStrip orgId={orgId} />
      </PageHeader>
      <OfflineBanner feature="Tool checkout" fromCache={fromCache} cachedAt={cachedAt} />
      {shell === "loading" ? (
        <div aria-busy="true" aria-label="Loading Tool checkout">
          <SoftBlockSkeleton lines={4} />
        </div>
      ) : shell === "error" ? (
        <ErrorState message={error ?? copy.description} onRetry={onRetry} />
      ) : (
        <EmptyState
          soft
          badge={shell === "setup" ? "Needs setup" : copy.badge}
          badgeTone="setup"
          title={copy.title}
          description={error ?? copy.description}
        >
          {setup ? (
            <Button as="a" variant="primary" href={setup.href}>
              {setup.label}
            </Button>
          ) : null}
          {shell === "empty" ? (
            <Button as="a" variant="primary" href={hubHref("/team", "equipment-maintenance", orgId)}>Open Equipment</Button>
          ) : null}
        </EmptyState>
      )}
      {shell === "ready" ? <NextActionsPanel actions={actions} /> : null}
    </main>
  );
}

export default function ToolCheckoutClient() {
  const [view, setView] = useState<ToolCheckoutView | null>(null);
  const [error, setError] = useState("");
  const [fetchFailed, setFetchFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [fromCache, setFromCache] = useState(false);
  const [cachedAt, setCachedAt] = useState<string | null>(null);
  const viewRef = useRef<ToolCheckoutView | null>(null);
  viewRef.current = view;

  const load = useCallback(async () => {
    const params = new URLSearchParams(window.location.search);
    const orgHint = params.get("orgId")?.trim() ?? "";
    let hadCache = Boolean(viewRef.current);
    try {
      const cached = await getFeatureSnapshot<ToolCheckoutView>("tool-checkout", orgHint || "_");
      if (!viewRef.current && cached?.data && isToolCheckoutView(cached.data)) {
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
    try {
      const query = new URLSearchParams();
      if (orgHint) query.set("orgId", orgHint);
      const response = await fetch(`/api/tool-checkout${query.toString() ? `?${query.toString()}` : ""}`, {
        cache: "no-store",
        signal: AbortSignal.timeout(FEATURE_API_TIMEOUT_MS),
      });
      const data: unknown = await response.json().catch(() => null);
      if (response.status === 401 || response.status === 403) {
        setView(null);
        setFromCache(false);
        setCachedAt(null);
        setFetchFailed(true);
        void clearFeatureSnapshot("tool-checkout", orgHint || "_");
        if (orgHint) void clearFeatureSnapshot("tool-checkout", orgHint);
        return;
      }
      if (!response.ok || !isToolCheckoutView(data)) {
        if (hadCache || viewRef.current) {
          setFromCache(true);
          setError("Could not refresh Tool checkout. Showing the last copy on this device.");
          setFetchFailed(false);
          return;
        }
        setFetchFailed(true);
        return;
      }
      setView(data);
      setFromCache(false);
      setCachedAt(null);
      await persistToolCheckoutSnapshot(orgHint, data);
    } catch {
      if (hadCache || viewRef.current) {
        setFromCache(true);
        setError("Could not refresh Tool checkout. Showing the last copy on this device.");
        setFetchFailed(false);
        return;
      }
      setFetchFailed(true);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const orgId = view && "orgId" in view ? view.orgId : null;
  const toolCount = view?.status === "live" ? view.summary.totalTools : 0;
  const overdueCount = view?.status === "live" ? view.summary.overdueCount : 0;

  const shell = classifyToolCheckoutShell({
    loading: view == null && !fetchFailed,
    fetchFailed: fetchFailed && !view,
    status: view?.status ?? null,
    orgId,
    toolCount,
  });
  const shellCopy = toolCheckoutShellCopy(shell);
  const nextActions = toolCheckoutNextActions({
    orgId,
    shell: shell === "empty" ? "ready" : shell,
    toolCount,
    overdueCount,
  });
  const teamHref = hubWorkbenchHref("team", "tool-checkout", orgId);
  const showTiles = shouldShowToolCheckoutSummaryTiles(toolCount);
  const loaded = view?.status === "live";

  const mutate = useCallback(
    async (payload: Record<string, unknown>) => {
      if (!orgId || busy) return;
      setBusy(true);
      setError("");
      try {
        const response = await fetch("/api/tool-checkout", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ orgId, ...payload }),
          signal: AbortSignal.timeout(FEATURE_API_TIMEOUT_MS),
        });
        const data: unknown = await response.json().catch(() => null);
        if (!response.ok || !isToolCheckoutView(data)) {
          setError(
            data && typeof data === "object" && "error" in data && typeof data.error === "string"
              ? data.error
              : "Something went wrong.",
          );
          return;
        }
        setView(data);
        setFromCache(false);
        void persistToolCheckoutSnapshot(orgId, data);
      } catch {
        setError("Network error — please try again.");
      } finally {
        setBusy(false);
      }
    },
    [orgId, busy],
  );

  if (shell === "loading") {
    return (
      <CheckoutShell
        description={shellCopy.description}
        orgId={null}
        shell="loading"
        fromCache={fromCache}
        cachedAt={cachedAt}
      />
    );
  }
  if (shell === "error") {
    return (
      <CheckoutShell
        description={shellCopy.description}
        orgId={orgId}
        shell="error"
        error={error || shellCopy.description}
        onRetry={() => void load()}
        fromCache={fromCache}
        cachedAt={cachedAt}
      />
    );
  }
  if (shell === "setup" || view?.status !== "live") {
    return (
      <CheckoutShell
        description={view?.status === "setup_required" ? view.message : shellCopy.description}
        orgId={orgId}
        shell="setup"
        fromCache={fromCache}
        cachedAt={cachedAt}
      />
    );
  }

  return (
    <main className="module-page tc-page">
      <PageHeader
        breadcrumbs={
          <>
            <a href={teamHref}>Team</a>
            {" / Tool checkout"}
          </>
        }
        title="Tool checkout"
        description="Track who has each shop tool and when it's due back."
      >
        <RelatedStrip orgId={orgId} />
      </PageHeader>
      <OfflineBanner feature="Tool checkout" fromCache={fromCache} cachedAt={cachedAt} />

      {error ? (
        <p className="telemetry-status" role="alert">
          {error}
        </p>
      ) : null}

      {showTiles ? (
        <Panel className="tc-panel">
          <div className="tc-stats">
            <StatTile label="Tools tracked" value={formatToolCheckoutMetric(view.summary.totalTools, loaded)} />
            <StatTile label="Available" value={formatToolCheckoutMetric(view.summary.availableCount, loaded)} />
            <StatTile label="Checked out" value={formatToolCheckoutMetric(view.summary.checkedOutCount, loaded)} />
            <StatTile label="Overdue" value={formatToolCheckoutMetric(view.summary.overdueCount, loaded)} />
          </div>
          {view.summary.byCategory.length > 0 ? (
            <small className="app-muted tc-block">
              {view.summary.byCategory
                .map((c) => `${toolCategoryLabel(c.category)}: ${c.checkedOut}/${c.total} out`)
                .join(" · ")}
            </small>
          ) : null}
        </Panel>
      ) : null}

      <AddToolForm busy={busy} mutate={mutate} />
      <ToolsPanel view={view} busy={busy} mutate={mutate} />
      <NextActionsPanel actions={nextActions} />
    </main>
  );
}

function ToolsPanel({
  view,
  busy,
  mutate,
}: {
  view: LiveView;
  busy: boolean;
  mutate: (payload: Record<string, unknown>) => void;
}) {
  if (view.tools.length === 0) {
    return (
      <EmptyState
        soft
        badge="No tools yet"
        badgeTone="setup"
        title="Add your first shop tool"
        description="Register tools to track who has each one and when it's due back."
      />
    );
  }
  return (
    <Panel id="tool-checkout-registry" className="tc-panel">
      <h2>Tool registry</h2>
      <ul className="tc-list">
        {view.tools.map((tool) => (
          <li key={tool.id} className="tc-row">
            <div>
              <strong>{tool.name}</strong>{" "}
              <Badge tone={STATUS_TONE[tool.status]}>{STATUS_LABEL[tool.status]}</Badge>
              <small className="app-muted tc-block">
                {toolCategoryLabel(tool.category)}
                {tool.assetTag ? ` · ${tool.assetTag}` : ""}
                {tool.location ? ` · ${tool.location}` : ""}
              </small>
              {tool.currentLoan ? (
                <small className="app-muted tc-block">
                  With {tool.currentLoan.borrowerName}
                  {tool.currentLoan.dueAt
                    ? ` · due ${new Date(tool.currentLoan.dueAt).toLocaleDateString()}`
                    : ""}
                </small>
              ) : null}
              {tool.notes ? <small className="app-muted tc-block">{tool.notes}</small> : null}
              {(tool.requiredSkills ?? []).length > 0 ? (
                <small className="app-muted tc-block">
                  Requires {tool.requiredSkills.map((skill) => skill.name).join(" or ")}
                </small>
              ) : null}
            </div>
            <div className="tc-actions">
              {tool.currentLoan ? (
                <Button variant="secondary" type="button" disabled={busy} onClick={() => mutate({ action: "return-tool", loanId: tool.currentLoan!.id })}>
                  Return
                </Button>
              ) : (
                <CheckoutButton
                  toolId={tool.id}
                  busy={busy}
                  mutate={mutate}
                  members={view.members ?? []}
                  requiredSkills={tool.requiredSkills ?? []}
                />
              )}
              <button
                type="button"
                className="text-button"
                disabled={busy}
                onClick={() => mutate({ action: "retire-tool", toolId: tool.id })}
              >
                Retire
              </button>
            </div>
          </li>
        ))}
      </ul>
    </Panel>
  );
}

function CheckoutButton({
  toolId,
  busy,
  mutate,
  members,
  requiredSkills,
}: {
  toolId: string;
  busy: boolean;
  mutate: (payload: Record<string, unknown>) => void;
  members: ToolCheckoutMemberOption[];
  requiredSkills: ToolRequiredSkill[];
}) {
  const [open, setOpen] = useState(false);
  const [borrowerUserId, setBorrowerUserId] = useState("");
  const [borrowerName, setBorrowerName] = useState("");
  const [dueAt, setDueAt] = useState("");

  if (!open) {
    return (
      <Button variant="primary" type="button" disabled={busy} onClick={() => setOpen(true)}>
        Check out
      </Button>
    );
  }

  const selected = members.find((member) => member.userId === borrowerUserId) ?? null;
  const name = selected?.name ?? borrowerName;
  const canConfirm = Boolean(name.trim()) && (requiredSkills.length === 0 || Boolean(selected));

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        if (!canConfirm) return;
        mutate({
          action: "checkout-tool",
          toolId,
          borrowerName: name,
          borrowerUserId: selected?.userId,
          dueAt: dueAt ? new Date(dueAt).toISOString() : undefined,
        });
        setBorrowerUserId("");
        setBorrowerName("");
        setDueAt("");
        setOpen(false);
      }}
      className="tc-checkout-form"
    >
      {members.length > 0 ? (
        <select
          value={borrowerUserId}
          onChange={(event) => setBorrowerUserId(event.target.value)}
          required={requiredSkills.length > 0}
          aria-label="Borrower"
        >
          <option value="">{requiredSkills.length > 0 ? "Certified member" : "Borrower"}</option>
          {members.map((member) => (
            <option key={member.userId} value={member.userId}>
              {member.name}
            </option>
          ))}
        </select>
      ) : (
        <input
          value={borrowerName}
          onChange={(event) => setBorrowerName(event.target.value)}
          placeholder="Borrower"
          required
        />
      )}
      <input type="date" value={dueAt} onChange={(event) => setDueAt(event.target.value)} />
      <Button variant="primary" type="submit" disabled={busy || !canConfirm}>
        Confirm
      </Button>
      <button type="button" className="text-button" onClick={() => setOpen(false)}>
        Cancel
      </button>
    </form>
  );
}

function AddToolForm({
  busy,
  mutate,
}: {
  busy: boolean;
  mutate: (payload: Record<string, unknown>) => void;
}) {
  const empty = useMemo(
    () => ({ name: "", category: "other" as ToolCategory, assetTag: "", location: "", notes: "" }),
    [],
  );
  const [form, setForm] = useState(empty);
  const set = (key: keyof typeof form) => (event: { target: { value: string } }) =>
    setForm((prev) => ({ ...prev, [key]: event.target.value }));

  return (
    <Panel
      id="tool-checkout-add"
      className="tc-panel"
      as="form"
      onSubmit={(event) => {
        event.preventDefault();
        if (!form.name.trim()) return;
        mutate({
          action: "add-tool",
          name: form.name,
          category: form.category,
          assetTag: form.assetTag || undefined,
          location: form.location || undefined,
          notes: form.notes || undefined,
        });
        setForm(empty);
      }}
    >
      <h2>Add tool</h2>
      <p className="app-muted tc-tip">Real shop tools only.</p>
      <FormGrid min={160}>
        <FormRow label="Name">
          <input value={form.name} onChange={set("name")} placeholder="Cordless drill" required />
        </FormRow>
        <FormRow label="Category">
          <select value={form.category} onChange={set("category")}>
            {TOOL_CATEGORIES.map((category) => (
              <option key={category} value={category}>
                {toolCategoryLabel(category)}
              </option>
            ))}
          </select>
        </FormRow>
        <FormRow label="Asset tag (optional)">
          <input value={form.assetTag} onChange={set("assetTag")} placeholder="PT-014" />
        </FormRow>
        <FormRow label="Location (optional)">
          <input value={form.location} onChange={set("location")} placeholder="Shop cabinet A" />
        </FormRow>
        <FormRow label="Notes (optional)" wide>
          <input value={form.notes} onChange={set("notes")} />
        </FormRow>
      </FormGrid>
      <div>
        <Button variant="primary" type="submit" disabled={busy || !form.name.trim()}>
          Add tool
        </Button>
      </div>
    </Panel>
  );
}
