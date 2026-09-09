"use client";

import { useMemo, useState, type ReactNode } from "react";
import { EmptyState, FormRow, PageHeader, Panel } from "../../../components/ui";
import {
  PAIR_RELATED_INCLUDE,
  classifyPairShell,
  formatPairMetric,
  pairNextActions,
  pairRelatedLinks,
  pairSetupSteps,
  pairShellCopy,
  shouldShowPairSummaryTiles,
  type PairNextAction,
  type PairShellKind,
} from "../../../lib/editor/pair-related";
import { hubHref } from "../../../lib/nav/hubs";
import { withOrgHref } from "../../../lib/nav/product-nav";
import "./pair.css";

export type PairOrganization = { id: string; name: string; role: string };

export type PairDevice = {
  id: string;
  orgId: string;
  orgName: string;
  machineName: string;
  editor: string;
  lastSeenAt: string | null;
  createdAt: string;
};

function PairRelatedStrip({ orgId }: { orgId?: string | null }) {
  const links = pairRelatedLinks(orgId, {
    include: [...PAIR_RELATED_INCLUDE],
  });
  if (!links.length) return null;
  return (
    <nav className="product-hub-related pair-related" aria-label="Related code tools">
      {links.map((link) => (
        <a key={link.id} className="app-button secondary" href={link.href}>
          {link.label}
        </a>
      ))}
    </nav>
  );
}

function PairNextActionsPanel({ actions }: { actions: PairNextAction[] }) {
  if (!actions.length) return null;
  return (
    <section className="app-card soft-panel edc-next-actions pair-next-actions" aria-label="Next actions">
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

function PairShell({
  description,
  orgId,
  shell,
  children,
}: {
  description: string;
  orgId?: string | null;
  shell: PairShellKind;
  children?: ReactNode;
}) {
  const actions = pairNextActions({ orgId, shell });
  const copy = pairShellCopy(shell);
  const buildHref = hubHref("/build", "code", orgId);
  const steps = shell === "setup" ? pairSetupSteps(orgId) : [];

  return (
    <main className="module-page pair-page soft-gate">
      <PageHeader
        breadcrumbs={
          <>
            <a href={buildHref}>Build</a>
            {" / Pair VS Code"}
          </>
        }
        title="Pair VS Code"
        description={description}
      >
        <PairRelatedStrip orgId={orgId} />
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
                ? "No editors paired yet"
                : copy.badge
        }
        badgeTone="setup"
        title={copy.title}
        description={copy.description}
      >
        {shell === "setup" ? (
          <a className="app-button" href={orgId ? withOrgHref("/workspace", orgId) : "/workspace"}>
            Open Workspace
          </a>
        ) : null}
      </EmptyState>
      {steps.length > 0 ? (
        <Panel className="pair-panel" aria-label="Setup steps">
          <header>
            <h2>Setup steps</h2>
            <p className="app-muted">Finish these once and this page fills in.</p>
          </header>
          <ul className="pair-setup-steps">
            {steps.map((step) => (
              <li key={step.id}>
                <div>
                  <strong>{step.label}</strong>
                  <p className="app-muted pair-tip">{step.detail}</p>
                </div>
                <a className="app-button secondary" href={step.href}>
                  Open
                </a>
              </li>
            ))}
          </ul>
        </Panel>
      ) : null}
      <PairNextActionsPanel actions={actions} />
    </main>
  );
}

function formatSeen(value: string | null): string {
  if (!value) return "Never seen";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Never seen";
  return `Last seen ${date.toLocaleString()}`;
}

export default function PairClient({
  initialCode,
  organizations,
  devices: initialDevices,
  preferredOrgId,
}: {
  initialCode: string;
  organizations: PairOrganization[];
  devices: PairDevice[];
  preferredOrgId?: string | null;
}) {
  const defaultOrgId =
    (preferredOrgId && organizations.some((org) => org.id === preferredOrgId)
      ? preferredOrgId
      : null) ??
    organizations[0]?.id ??
    "";

  const [code, setCode] = useState(initialCode);
  const [orgId, setOrgId] = useState(defaultOrgId);
  const [devices, setDevices] = useState(initialDevices);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [approved, setApproved] = useState(false);

  const hasOrgs = organizations.length > 0;
  const deviceCount = devices.length;
  const shell = classifyPairShell({
    hasOrgs,
    orgId: orgId || null,
    deviceCount,
  });
  const shellCopy = pairShellCopy(shell);
  const nextActions = pairNextActions({
    orgId: orgId || null,
    shell,
    deviceCount,
    hasCode: Boolean(code.trim()),
  });
  const relatedLinks = pairRelatedLinks(orgId || null, {
    include: [...PAIR_RELATED_INCLUDE],
  });
  const buildHref = hubHref("/build", "code", orgId || null);
  const showTiles = shouldShowPairSummaryTiles({ deviceCount });

  const orgNameById = useMemo(() => {
    const map = new Map(organizations.map((org) => [org.id, org.name]));
    return map;
  }, [organizations]);

  async function approve(event: React.FormEvent) {
    event.preventDefault();
    if (!orgId || busy) return;
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch("/api/editor/pair/approve", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ code, orgId }),
      });
      const data = (await response.json()) as {
        machineName?: string;
        deviceId?: string;
        error?: string;
      };
      if (!response.ok) {
        setMessage(data.error ?? "Approval failed");
        return;
      }
      setApproved(true);
      setMessage(
        `${data.machineName ?? "Editor"} is paired. Return to VS Code — the extension will finish automatically.`,
      );
      const machineName = data.machineName?.trim() || "Paired editor";
      const orgName = orgNameById.get(orgId) ?? "Workspace";
      setDevices((prev) => {
        if (data.deviceId && prev.some((row) => row.id === data.deviceId)) return prev;
        return [
          {
            id: data.deviceId ?? `local-${Date.now()}`,
            orgId,
            orgName,
            machineName,
            editor: "vscode",
            lastSeenAt: new Date().toISOString(),
            createdAt: new Date().toISOString(),
          },
          ...prev,
        ];
      });
    } finally {
      setBusy(false);
    }
  }

  if (shell === "setup") {
    return (
      <PairShell description={shellCopy.description} orgId={orgId || null} shell="setup" />
    );
  }

  return (
    <main className="module-page pair-page">
      <PageHeader
        breadcrumbs={
          <>
            <a href={buildHref}>Build</a>
            {" / Pair VS Code"}
          </>
        }
        title="Pair VS Code"
        description="Approve a short code from the Vantage VS Code extension. Only machines you control — passwords never enter the editor. Cross-check Code Coach, GitHub, and AI."
      >
        <div className="pair-header-actions">
          {relatedLinks.map((link) => (
            <a key={link.id} className="app-button secondary" href={link.href}>
              {link.label}
            </a>
          ))}
        </div>
      </PageHeader>

      {showTiles ? (
        <section className="pair-stats" aria-label="Paired editor counts">
          <div>
            <strong>{formatPairMetric(deviceCount, true)}</strong>
            <p className="app-muted">Paired editors</p>
          </div>
        </section>
      ) : null}

      {shell === "empty" && !approved ? (
        <EmptyState
          soft
          badge="No editors paired yet"
          badgeTone="setup"
          title={shellCopy.title}
          description={shellCopy.description}
          className="product-hub-setup"
        >
          <a className="app-button" href="#pair-approve">
            Enter pairing code
          </a>
          <a className="app-button secondary" href={hubHref("/build", "code", orgId)}>
            Open Code Coach
          </a>
          <a
            className="app-button secondary"
            href={withOrgHref("/team/admin", orgId) + "#github-connection"}
          >
            GitHub context
          </a>
        </EmptyState>
      ) : null}

      <div className="pair-layout">
        <Panel className="pair-panel" id="pair-approve" aria-label="Approve pairing">
          <header>
            <h2>Approve pairing</h2>
            <p className="app-muted">
              Only approve a code shown in an editor you control. The extension sends file or selection
              context only when you opt in on each share.
            </p>
          </header>
          <form className="pair-form" onSubmit={(e) => void approve(e)}>
            <FormRow label="Pairing code" hint="8–9 characters shown in the Vantage VS Code extension.">
              <input
                value={code}
                onChange={(e) => setCode(e.target.value.toUpperCase())}
                pattern="[A-Z0-9-]{8,9}"
                required
                autoComplete="one-time-code"
                spellCheck={false}
              />
            </FormRow>
            <FormRow label="Organization / workspace">
              <select value={orgId} onChange={(e) => setOrgId(e.target.value)} required>
                {organizations.map((org) => (
                  <option value={org.id} key={org.id}>
                    {org.name} · {org.role}
                  </option>
                ))}
              </select>
            </FormRow>
            <button type="submit" className="app-button" disabled={busy || !organizations.length}>
              {busy ? "Approving…" : "Approve pairing"}
            </button>
            {message ? (
              <p role="status" className="pair-message">
                {message}
              </p>
            ) : null}
          </form>
        </Panel>

        <Panel className="pair-panel" aria-label="Paired editors">
          <header>
            <h2>Paired editors</h2>
            <p className="app-muted">Real device rows only.</p>
          </header>
          {deviceCount === 0 ? (
            <EmptyState
              soft
              badge="Empty"
              badgeTone="setup"
              title="No paired devices yet"
              description="Device rows appear only after a real approval."
            >
              <a className="app-button secondary" href={hubHref("/ai", "chat", orgId)}>
                Open AI chat
              </a>
            </EmptyState>
          ) : (
            <ul className="pair-device-list">
              {devices.map((device) => (
                <li key={device.id} className="app-card soft-panel pair-device-card">
                  <div>
                    <strong>{device.machineName}</strong>
                    <p className="app-muted pair-tip">
                      {device.orgName} · {device.editor}
                    </p>
                    <p className="app-muted pair-tip">{formatSeen(device.lastSeenAt)}</p>
                  </div>
                  <span className="app-badge good">Paired</span>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>

      <PairNextActionsPanel actions={nextActions} />
    </main>
  );
}
