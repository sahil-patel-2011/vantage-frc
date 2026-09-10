"use client";

import { useCallback, useEffect, useState } from "react";
import { Badge, Button, EmptyState, PageHeader } from "../../components/ui";
import {
  connectorBadge,
  connectorConnectEndpoint,
  connectorDisconnectEndpoint,
  type ConnectorStatusView,
} from "../../lib/connectors/actions";
import "./connectors.css";

type ConnectorsView = {
  orgId: string | null;
  role: string | null;
  canManage: boolean;
  summary: string;
  connectors: ConnectorStatusView[];
  degraded?: string;
};

const SCOPE_NOTE: Record<string, string> = {
  platform: "Deployment-wide — set by whoever runs this Vantage deployment.",
  team: "Saved per team — an owner or admin links it once for everyone.",
  member: "Personal — each member authorises their own account.",
};

function CopyableUrl({ label, url }: { label: string; url: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="connector-callback">
      <span className="connector-callback-label">{label}</span>
      <code className="connector-callback-url">{url}</code>
      <button
        type="button"
        className="app-button secondary connector-copy"
        onClick={() => {
          void navigator.clipboard?.writeText(url).then(
            () => {
              setCopied(true);
              window.setTimeout(() => setCopied(false), 2000);
            },
            () => setCopied(false),
          );
        }}
      >
        {copied ? "Copied" : "Copy"}
      </button>
    </div>
  );
}

export default function ConnectorsClient() {
  const [view, setView] = useState<ConnectorsView | null>(null);
  const [loading, setLoading] = useState(true);
  const [fetchFailed, setFetchFailed] = useState(false);
  const [message, setMessage] = useState("");
  const [messageOk, setMessageOk] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setFetchFailed(false);
    try {
      const response = await fetch("/api/connectors");
      const data = (await response.json()) as ConnectorsView & { error?: string };
      if (!response.ok) {
        setFetchFailed(true);
        setMessage(data.error ?? "Could not load connector status.");
        setView(null);
        return;
      }
      setView(data);
    } catch {
      setFetchFailed(true);
      setMessage("Could not load connector status.");
      setView(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function connect(connector: ConnectorStatusView, orgId: string | null) {
    const endpoint = connectorConnectEndpoint(connector.id);
    if (!endpoint || !orgId) return;
    setBusyId(connector.id);
    setMessage("");
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ orgId, action: "authorize-url" }),
      });
      const data = (await response.json()) as { url?: string; error?: string; message?: string };
      if (!response.ok || !data.url) {
        setMessageOk(false);
        // The provider endpoints answer a missing client with their own setup
        // message; showing it beats a generic "Connect failed" that sends the
        // reader back to a card that already told them what is missing.
        setMessage(data.message || data.error || `Could not start the ${connector.label} authorisation.`);
        return;
      }
      window.location.href = data.url;
    } catch {
      setMessageOk(false);
      setMessage(`Could not reach the server to start the ${connector.label} authorisation.`);
    } finally {
      setBusyId(null);
    }
  }

  async function disconnect(connector: ConnectorStatusView, orgId: string | null) {
    const endpoint = connectorDisconnectEndpoint(connector.id);
    if (!endpoint || !orgId) return;
    setBusyId(connector.id);
    setMessage("");
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ orgId, action: "disconnect" }),
      });
      const data = (await response.json()) as { error?: string };
      setMessageOk(response.ok);
      setMessage(
        response.ok
          ? `${connector.label} disconnected. The stored credential was overwritten, not just marked inactive.`
          : (data.error ?? `Could not disconnect ${connector.label}.`),
      );
      if (response.ok) await load();
    } catch {
      setMessageOk(false);
      setMessage(`Could not reach the server to disconnect ${connector.label}.`);
    } finally {
      setBusyId(null);
    }
  }

  if (loading) {
    return (
      <main className="module-page connectors-page">
        <PageHeader
          breadcrumbs="Settings / Connectors"
          title="Connectors"
          description="Checking what this deployment has configured and what this team has linked."
        />
        <EmptyState soft badge="Loading" badgeTone="setup" title="Loading connectors" description="Reading deployment configuration and stored links." />
      </main>
    );
  }

  if (fetchFailed || !view) {
    return (
      <main className="module-page connectors-page">
        <PageHeader breadcrumbs="Settings / Connectors" title="Connectors" description="Every service Vantage talks to." />
        <EmptyState
          soft
          badge="Unavailable"
          badgeTone="setup"
          title="Could not load connector status"
          description={message || "A network or server issue prevented loading. Retry, or open Support if this keeps failing."}
        >
          <button type="button" className="app-button" onClick={() => { setLoading(true); void load(); }}>
            Retry
          </button>
        </EmptyState>
      </main>
    );
  }

  const { orgId, canManage, connectors } = view;

  return (
    <main className="module-page connectors-page">
      <PageHeader
        breadcrumbs="Settings / Connectors"
        title="Connectors"
        description={`Every service Vantage talks to, what it is missing, and the exact URL to register with the provider. ${view.summary}.`}
      />

      {view.degraded ? (
        <p className="connector-banner" role="status">
          {view.degraded}
        </p>
      ) : null}

      {!orgId ? (
        <p className="connector-banner" role="status">
          You are not in a workspace, so team-linked connectors below show deployment configuration only.{" "}
          <a href="/workspace">Select a workspace</a> to link GitHub, Discord, Slack or a storage node.
        </p>
      ) : null}

      {message ? (
        <p className={`connector-message${messageOk ? " success" : ""}`} role="status">
          {message}
        </p>
      ) : null}

      <ul className="connector-list">
        {connectors.map((connector) => {
          const badge = connectorBadge(connector.state);
          const busy = busyId === connector.id;
          const managedByOthers = connector.scope === "team" && !canManage;
          return (
            <li key={connector.id} className="app-card soft-panel connector-card">
              <div className="connector-head">
                <div className="connector-identity">
                  <h2>{connector.label}</h2>
                  <Badge tone={badge.tone}>{badge.label}</Badge>
                </div>
                <p className="connector-status-line">{connector.statusLine}</p>
              </div>

              <p className="connector-detail">{connector.detail}</p>
              <p className="app-muted connector-scope">{SCOPE_NOTE[connector.scope]}</p>

              {connector.missingEnv.length > 0 ? (
                <ul className="connector-env">
                  {connector.missingEnv.map((name) => (
                    <li key={name}>
                      <code>{name}</code>
                    </li>
                  ))}
                </ul>
              ) : null}

              {connector.callbackUrl ? (
                <CopyableUrl label={connector.callbackLabel} url={connector.callbackUrl} />
              ) : null}

              {connector.permissions.length > 0 ? (
                <p className="app-muted connector-permissions">
                  Grant in the provider: {connector.permissions.join(", ")}.
                </p>
              ) : null}

              <div className="connector-actions">
                {connector.canConnect && connectorConnectEndpoint(connector.id) ? (
                  <button
                    type="button"
                    className="app-button"
                    disabled={busy || !orgId || managedByOthers}
                    title={
                      !orgId
                        ? "Select a workspace first — this link is saved per team."
                        : managedByOthers
                          ? "Only an owner or admin can change this team's link."
                          : undefined
                    }
                    onClick={() => void connect(connector, orgId)}
                  >
                    {connector.state === "token_expired" ? "Reconnect" : "Connect"}
                  </button>
                ) : null}

                {connector.canDisconnect && connectorDisconnectEndpoint(connector.id) ? (
                  <button
                    type="button"
                    className="app-button secondary"
                    disabled={busy || !orgId || managedByOthers}
                    title={managedByOthers ? "Only an owner or admin can change this team's link." : undefined}
                    onClick={() => void disconnect(connector, orgId)}
                  >
                    Disconnect
                  </button>
                ) : null}

                <Button as="a" href={orgId ? withOrg(connector.managePath, orgId) : connector.managePath} variant="ghost" size="sm">
                  Open settings
                </Button>
              </div>
            </li>
          );
        })}
      </ul>
    </main>
  );
}

/** Append orgId without clobbering a path that already carries a query string. */
function withOrg(path: string, orgId: string): string {
  if (path.includes("orgId=")) return path;
  return `${path}${path.includes("?") ? "&" : "?"}orgId=${encodeURIComponent(orgId)}`;
}
