"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { OfflineBanner } from "../../components/offline-banner";
import { Badge, Button, EmptyState, PageHeader } from "../../components/ui";
import {
  connectorBadge,
  connectorConnectEndpoint,
  connectorDisconnectEndpoint,
  type ConnectorStatusView,
} from "../../lib/connectors/actions";
import {
  CONNECTORS_PAGE_LOADING,
  connectorAudienceFromRole,
  connectorScopeNote,
  connectorsPageDescription,
} from "../../lib/connectors/catalog";
import CadDocumentPicker from "../cad/connections/cad-document-picker";
import { FEATURE_API_TIMEOUT_MS } from "../../lib/nav/resolve-org";
import { getFeatureSnapshot, putFeatureSnapshot } from "../../lib/offline/feature-cache";
import "./connectors.css";

type ConnectorsView = {
  orgId: string | null;
  role: string | null;
  canManage: boolean;
  summary: string;
  connectors: ConnectorStatusView[];
  degraded?: string;
};

function CopyableUrl({ label, url }: { label: string; url: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="connector-callback">
      <span className="connector-callback-label">{label}</span>
      <code className="connector-callback-url">{url}</code>
      <Button variant="secondary" type="button" className="connector-copy" onClick={() => { void navigator.clipboard?.writeText(url).then( () => { setCopied(true); window.setTimeout(() => setCopied(false), 2000); }, () => setCopied(false), ); }}>
        {copied ? "Copied" : "Copy"}
      </Button>
    </div>
  );
}

function isConnectorsView(value: unknown): value is ConnectorsView {
  if (!value || typeof value !== "object") return false;
  return Array.isArray((value as { connectors?: unknown }).connectors);
}

function connectorsCacheOrg(data: ConnectorsView, orgHint: string): string {
  if (typeof data.orgId === "string" && data.orgId.trim()) return data.orgId;
  return orgHint;
}

async function persistConnectorsSnapshot(orgHint: string, data: ConnectorsView): Promise<void> {
  const cacheOrg = connectorsCacheOrg(data, orgHint);
  if (!cacheOrg) return;
  try {
    await putFeatureSnapshot("connectors", cacheOrg, data);
    if (!orgHint) await putFeatureSnapshot("connectors", "_", data);
  } catch {
    // Live Connectors already painted; IndexedDB is best-effort.
  }
}

export default function ConnectorsClient() {
  const [view, setView] = useState<ConnectorsView | null>(null);
  const [fetchFailed, setFetchFailed] = useState(false);
  const [errorStatus, setErrorStatus] = useState<number | null>(null);
  const [message, setMessage] = useState("");
  const [messageOk, setMessageOk] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [fromCache, setFromCache] = useState(false);
  const [cachedAt, setCachedAt] = useState<string | null>(null);
  const viewRef = useRef<ConnectorsView | null>(null);
  viewRef.current = view;

  const load = useCallback(async () => {
    const params = new URLSearchParams(window.location.search);
    const orgHint = params.get("orgId")?.trim() ?? "";
    let hadCache = Boolean(viewRef.current);
    try {
      const cached = await getFeatureSnapshot<ConnectorsView>("connectors", orgHint || "_");
      if (!viewRef.current && cached?.data && isConnectorsView(cached.data)) {
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
    try {
      const response = await fetch("/api/connectors", {
        cache: "no-store",
        signal: AbortSignal.timeout(FEATURE_API_TIMEOUT_MS),
      });
      const data: unknown = await response.json().catch(() => null);
      if (response.status === 401 || response.status === 403) {
        if (hadCache || viewRef.current) {
          setFromCache(true);
          setMessage("Could not refresh Connectors. Showing the last copy on this device.");
          setFetchFailed(false);
          return;
        }
        setView(null);
        setFromCache(false);
        setCachedAt(null);
        setFetchFailed(true);
        setErrorStatus(response.status);
        setMessage(
          data && typeof data === "object" && "error" in data && typeof data.error === "string"
            ? data.error
            : "Could not load connector status.",
        );
        return;
      }
      if (!response.ok || !isConnectorsView(data)) {
        if (hadCache || viewRef.current) {
          setFromCache(true);
          setMessage("Could not refresh Connectors. Showing the last copy on this device.");
          setFetchFailed(false);
          return;
        }
        setFetchFailed(true);
        setErrorStatus(response.status);
        setMessage(
          data && typeof data === "object" && "error" in data && typeof data.error === "string"
            ? data.error
            : "Could not load connector status.",
        );
        return;
      }
      setView(data);
      setFromCache(false);
      setCachedAt(null);
      await persistConnectorsSnapshot(orgHint, data);
    } catch {
      if (hadCache || viewRef.current) {
        setFromCache(true);
        setMessage("Could not refresh Connectors. Showing the last copy on this device.");
        setFetchFailed(false);
        return;
      }
      setFetchFailed(true);
      setMessage("Could not load connector status.");
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

  const chooseTeam = fetchFailed && (errorStatus === 401 || errorStatus === 403);

  if (!view) {
    return (
      <main className="module-page connectors-page">
        <PageHeader
          breadcrumbs="Settings / Connectors"
          title="Connectors"
          description={CONNECTORS_PAGE_LOADING}
        />
        <OfflineBanner feature="Connectors" fromCache={fromCache} cachedAt={cachedAt} />
        {fetchFailed ? (
          <EmptyState
            soft
            badge={chooseTeam ? "Needs setup" : "Unavailable"}
            badgeTone="setup"
            title={chooseTeam ? "Choose your team" : "Could not load connector status"}
            description={
              chooseTeam
                ? "Choose your team to see what this team has linked."
                : message || "A network or server issue prevented loading. Retry, or open Support if this keeps failing."
            }
          >
            {chooseTeam ? (
              <Button as="a" variant="primary" href="/workspace">
                Choose your team
              </Button>
            ) : (
              <Button variant="primary" type="button" onClick={() => void load()}>
                Retry
              </Button>
            )}
          </EmptyState>
        ) : (
          <EmptyState
            soft
            badge="Loading"
            badgeTone="setup"
            title="Loading connectors"
            description={CONNECTORS_PAGE_LOADING}
          />
        )}
      </main>
    );
  }

  const { orgId, canManage, connectors } = view;

  return (
    <main className="module-page connectors-page">
      <PageHeader
        breadcrumbs="Settings / Connectors"
        title="Connectors"
        description={connectorsPageDescription({ canManage, summary: view.summary })}
      />
      <OfflineBanner feature="Connectors" fromCache={fromCache} cachedAt={cachedAt} />

      {view.degraded ? (
        <p className="connector-banner" role="status">
          {view.degraded}
        </p>
      ) : null}

      {!orgId ? (
        <p className="connector-banner" role="status">
          You are not in a team, so team-linked connectors below show deployment configuration only.{" "}
          <a href="/workspace">Choose your team</a> to link GitHub, Discord, Slack or a storage node.
        </p>
      ) : null}

      {message ? (
        <p className={`connector-message${messageOk ? " success" : ""}`} role="status">
          {message}
        </p>
      ) : null}

      <ul className="connector-list">
        {connectors.map((connector) => {
          const audience = connectorAudienceFromRole(canManage);
          const badge = connectorBadge(connector.state, audience);
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
              <p className="app-muted connector-scope">{connectorScopeNote(connector.scope, audience)}</p>

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
                  {canManage
                    ? `Grant in the provider: ${connector.permissions.join(", ")}.`
                    : connector.permissions[0]}
                </p>
              ) : null}

              <div className="connector-actions">
                {connector.canConnect && connectorConnectEndpoint(connector.id) ? (
                  <Button variant="primary" type="button" disabled={busy || !orgId || managedByOthers} title={ !orgId ? "Choose your team first — this link is saved per team." : managedByOthers ? "Only an owner or admin can change this team's link." : undefined } onClick={() => void connect(connector, orgId)}>
                    {connector.state === "token_expired" ? "Reconnect" : "Connect"}
                  </Button>
                ) : null}

                {connector.canDisconnect && connectorDisconnectEndpoint(connector.id) ? (
                  <Button variant="secondary" type="button" disabled={busy || !orgId || managedByOthers} title={managedByOthers ? "Only an owner or admin can change this team's link." : undefined} onClick={() => void disconnect(connector, orgId)}>
                    Disconnect
                  </Button>
                ) : null}

                <Button as="a" href={orgId ? withOrg(connector.managePath, orgId) : connector.managePath} variant="ghost" size="sm">
                  Open settings
                </Button>
              </div>
              {connector.id === "onshape" && orgId ? (
                <CadDocumentPicker orgId={orgId} connected={connector.state === "connected"} />
              ) : null}
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
