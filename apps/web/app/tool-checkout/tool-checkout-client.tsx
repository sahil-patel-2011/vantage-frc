"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
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
  StatTile,
} from "../../components/ui";
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
import { withOrgHref } from "../../lib/nav/product-nav";
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

function RelatedStrip({ orgId }: { orgId?: string | null }) {
  const links = toolCheckoutRelatedLinks(orgId, {
    include: [...TOOL_CHECKOUT_RELATED_INCLUDE],
  });
  if (!links.length) return null;
  return (
    <nav className="product-hub-related tc-related" aria-label="Related team tools">
      {links.map((link) => (
        <a key={link.id} className="app-button secondary" href={link.href}>
          {link.label}
        </a>
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
            <a className="app-button secondary" href={action.href}>
              Open
            </a>
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
}: {
  description: string;
  orgId?: string | null;
  shell: ToolCheckoutShellKind;
  error?: string;
  onRetry?: () => void;
}) {
  const actions = toolCheckoutNextActions({ orgId, shell });
  const copy = toolCheckoutShellCopy(shell);
  const teamHref = hubWorkbenchHref("team", "tool-checkout", orgId);
  const steps = shell === "setup" ? toolCheckoutSetupSteps(orgId) : [];

  return (
    <main className="module-page tc-page soft-gate">
      <PageHeader
        breadcrumbs={
          <>
            <a href={teamHref}>Team</a>
            {" / Tool Checkout"}
          </>
        }
        title="Tool Checkout"
        description={description}
      >
        <RelatedStrip orgId={orgId} />
      </PageHeader>
      {shell === "loading" ? (
        <div aria-busy="true" aria-label="Loading Tool Checkout">
          <SoftBlockSkeleton lines={4} />
        </div>
      ) : shell === "error" ? (
        <ErrorState message={error ?? copy.description} onRetry={onRetry} />
      ) : (
        <EmptyState
          soft
          badge={shell === "setup" ? "Setup required" : copy.badge}
          badgeTone="setup"
          title={copy.title}
          description={error ?? copy.description}
        >
          {shell === "setup" ? (
            <a className="app-button" href={orgId ? withOrgHref("/workspace", orgId) : "/workspace"}>
              Open Workspace
            </a>
          ) : null}
          {shell === "empty" ? (
            <>
              <a className="app-button" href={hubHref("/team", "equipment-maintenance", orgId)}>
                Open Equipment
              </a>
              <a className="app-button secondary" href={withOrgHref("/inventory", orgId)}>
                Open Inventory
              </a>
            </>
          ) : null}
        </EmptyState>
      )}
      {steps.length > 0 ? (
        <Panel className="tc-panel" aria-label="Setup steps">
          <header>
            <h2>Setup steps</h2>
            <p className="app-muted">Finish these once and this page fills in.</p>
          </header>
          <ul className="tc-setup-steps">
            {steps.map((step) => (
              <li key={step.id}>
                <div>
                  <strong>{step.label}</strong>
                  <p className="app-muted tc-tip">{step.detail}</p>
                </div>
                <a className="app-button secondary" href={step.href}>
                  Open
                </a>
              </li>
            ))}
          </ul>
        </Panel>
      ) : null}
      {steps.length === 0 ? <NextActionsPanel actions={actions} /> : null}
    </main>
  );
}

export default function ToolCheckoutClient() {
  const [view, setView] = useState<ToolCheckoutView | null>(null);
  const [error, setError] = useState("");
  const [fetchFailed, setFetchFailed] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    setFetchFailed(false);
    setError("");
    const params = new URLSearchParams(window.location.search);
    const urlOrg = params.get("orgId");
    const query = new URLSearchParams();
    if (urlOrg) query.set("orgId", urlOrg);
    void fetch(`/api/tool-checkout${query.toString() ? `?${query.toString()}` : ""}`)
      .then(async (response) => {
        const data = (await response.json()) as ToolCheckoutView | { error?: string };
        if (!response.ok || !("status" in data)) {
          setFetchFailed(true);
          return;
        }
        setView(data);
      })
      .catch(() => setFetchFailed(true));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const orgId = view && "orgId" in view ? view.orgId : null;
  const toolCount = view?.status === "live" ? view.summary.totalTools : 0;
  const overdueCount = view?.status === "live" ? view.summary.overdueCount : 0;

  const shell = classifyToolCheckoutShell({
    loading: view == null && !fetchFailed,
    fetchFailed,
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
        });
        const data = (await response.json()) as ToolCheckoutView | { error?: string };
        if (!response.ok || !("status" in data)) {
          setError("error" in data && data.error ? data.error : "Something went wrong.");
          return;
        }
        setView(data);
      } catch {
        setError("Network error — please try again.");
      } finally {
        setBusy(false);
      }
    },
    [orgId, busy],
  );

  if (shell === "loading") {
    return <CheckoutShell description={shellCopy.description} orgId={null} shell="loading" />;
  }
  if (shell === "error") {
    return (
      <CheckoutShell
        description={shellCopy.description}
        orgId={orgId}
        shell="error"
        error={error || shellCopy.description}
        onRetry={() => load()}
      />
    );
  }
  if (shell === "setup" || view?.status !== "live") {
    return (
      <CheckoutShell
        description={view?.status === "setup_required" ? view.message : shellCopy.description}
        orgId={orgId}
        shell="setup"
      />
    );
  }

  return (
    <main className="module-page tc-page">
      <PageHeader
        breadcrumbs={
          <>
            <a href={teamHref}>Team</a>
            {" / Tool Checkout"}
          </>
        }
        title="Tool Checkout"
        description="Track who has each shop tool and when it's due back."
      >
        <RelatedStrip orgId={orgId} />
      </PageHeader>

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
                <button
                  type="button"
                  className="app-button secondary"
                  disabled={busy}
                  onClick={() => mutate({ action: "return-tool", loanId: tool.currentLoan!.id })}
                >
                  Return
                </button>
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
      <button type="button" className="app-button" disabled={busy} onClick={() => setOpen(true)}>
        Check out
      </button>
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
      <button type="submit" className="app-button" disabled={busy || !canConfirm}>
        Confirm
      </button>
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
        <button type="submit" className="app-button" disabled={busy || !form.name.trim()}>
          Add tool
        </button>
      </div>
    </Panel>
  );
}
