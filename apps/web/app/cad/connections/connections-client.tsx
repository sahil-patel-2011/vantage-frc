"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { OfflineBanner } from "../../../components/offline-banner";
import { Button, EmptyState, PageHeader } from "../../../components/ui";
import {
  ONSHAPE_OAUTH_CTA,
  onshapeAccountLabel,
  onshapeHostedBadge,
  onshapeOauthCtaEnabled,
} from "../../../lib/cad/onshape-setup-strings";
import { FEATURE_API_TIMEOUT_MS } from "../../../lib/nav/resolve-org";
import { withOrgHref } from "../../../lib/nav/product-nav";
import { getFeatureSnapshot, putFeatureSnapshot } from "../../../lib/offline/feature-cache";
import { classifyLoadFailure, loadFailureCopy } from "../../../lib/ui/load-failure";

type Device = {
  id: string;
  machineName: string;
  platform: string;
  status: string;
  cliVersion: string | null;
  lastSeenAt: string | null;
  revokedAt: string | null;
};

type OnshapeConnection = {
  id: string;
  status: string;
  label: string;
  externalAccountRef?: string | null;
};

type CadConnectionsView = {
  status: "live";
  orgId: string;
  devices: Device[];
  onshapeOauthReady: boolean;
  onshapeConnections: OnshapeConnection[];
  onshapeSetupMessage: string;
};

function isCadConnectionsView(value: unknown): value is CadConnectionsView {
  if (!value || typeof value !== "object") return false;
  const row = value as { status?: unknown; orgId?: unknown; devices?: unknown };
  return row.status === "live" && typeof row.orgId === "string" && Array.isArray(row.devices);
}

function responseError(data: unknown): string {
  return data && typeof data === "object" && "error" in data && typeof data.error === "string"
    ? data.error
    : "";
}

async function persistCadConnectionsSnapshot(orgHint: string, data: CadConnectionsView): Promise<void> {
  const cacheOrg = data.orgId.trim() || orgHint;
  if (!cacheOrg) return;
  try {
    await putFeatureSnapshot("cad-connections", cacheOrg, data);
    if (!orgHint) await putFeatureSnapshot("cad-connections", "_", data);
  } catch {
    // Live CAD connections already painted; IndexedDB is best-effort.
  }
}

export function CadConnectionsRelated({ orgId }: { orgId: string | null }) {
  return (
    <nav className="product-hub-related" aria-label="Related CAD tools">
      <Button as="a" variant="secondary" href={withOrgHref("/cad", orgId)}>
        CAD
      </Button>
      <Button as="a" variant="secondary" href={withOrgHref("/cad-vault", orgId)}>
        CAD Vault
      </Button>
      <Button as="a" variant="secondary" href={withOrgHref("/cad-learn", orgId)}>
        Learn CAD
      </Button>
    </nav>
  );
}

function CadConnectionsNextActions({
  orgId,
  onshapeConnected,
  hasDesktop,
}: {
  orgId: string;
  onshapeConnected: boolean;
  hasDesktop: boolean;
}) {
  const actions = [
    !onshapeConnected
      ? {
          id: "onshape",
          label: "Connect Onshape",
          detail: "Authorize in the browser. Never type your password in a terminal.",
          href: "#onshape",
          primary: true as const,
        }
      : {
          id: "cad",
          label: "Open CAD",
          detail: "Pick a document after Onshape is connected.",
          href: withOrgHref("/cad", orgId),
          primary: true as const,
        },
    {
      id: "desktop",
      label: hasDesktop ? "Review paired desktops" : "Pair Fusion desktop",
      detail: "Fusion stays on this computer. Pair it here when you need the desktop app.",
      href: withOrgHref("/cad/pair", orgId),
    },
  ];
  return (
    <section className="app-card soft-panel edc-next-actions" aria-label="Next actions">
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

export default function CadConnections({ orgId }: { orgId: string }) {
  const [view, setView] = useState<CadConnectionsView | null>(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [fetchFailed, setFetchFailed] = useState(false);
  const [errorStatus, setErrorStatus] = useState<number | null>(null);
  const [fromCache, setFromCache] = useState(false);
  const [cachedAt, setCachedAt] = useState<string | null>(null);
  const viewRef = useRef<CadConnectionsView | null>(null);
  viewRef.current = view;

  const load = useCallback(async () => {
    let hadCache = Boolean(viewRef.current);
    try {
      const cached = await getFeatureSnapshot<CadConnectionsView>("cad-connections", orgId || "_");
      if (!viewRef.current && cached?.data && isCadConnectionsView(cached.data)) {
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
      const response = await fetch(`/api/cad?orgId=${encodeURIComponent(orgId)}`, {
        cache: "no-store",
        signal: AbortSignal.timeout(FEATURE_API_TIMEOUT_MS),
      });
      const body: unknown = await response.json().catch(() => null);
      if (response.status === 401 || response.status === 403) {
        setView(null);
        setFromCache(false);
        setCachedAt(null);
        setFetchFailed(true);
        setErrorStatus(response.status);
        setMessage(responseError(body) || "Could not load CAD connections.");
        return;
      }
      if (!response.ok || !body || typeof body !== "object") {
        if (hadCache || viewRef.current) {
          setFromCache(true);
          setMessage("Could not refresh CAD connections. Showing the last copy on this device.");
          setFetchFailed(false);
          return;
        }
        setFetchFailed(true);
        setErrorStatus(response.status);
        setMessage(responseError(body) || "Could not load CAD connections.");
        return;
      }
      const row = body as {
        devices?: Device[];
        onshape?: { setupRequired?: boolean; message?: string };
        onshapeConnections?: OnshapeConnection[];
        error?: string;
      };
      const oauthReady = onshapeOauthCtaEnabled(row.onshape);
      const next: CadConnectionsView = {
        status: "live",
        orgId,
        devices: Array.isArray(row.devices) ? row.devices : [],
        onshapeOauthReady: oauthReady,
        onshapeConnections: Array.isArray(row.onshapeConnections) ? row.onshapeConnections : [],
        onshapeSetupMessage:
          row.onshape?.setupRequired || !oauthReady
            ? oauthReady
              ? String(row.onshape?.message ?? "Connect Onshape in the browser to run hosted CAD jobs.")
              : ONSHAPE_OAUTH_CTA.disabledDetail
            : "",
      };
      setView(next);
      setFromCache(false);
      setCachedAt(null);
      setMessage("");
      await persistCadConnectionsSnapshot(orgId, next);
    } catch {
      if (hadCache || viewRef.current) {
        setFromCache(true);
        setMessage("Could not refresh CAD connections. Showing the last copy on this device.");
        setFetchFailed(false);
        return;
      }
      setFetchFailed(true);
      setMessage("Could not load CAD connections.");
    }
  }, [orgId]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("onshape") === "connected") setMessage("Onshape connected.");
    if (params.get("onshape") === "denied") setMessage("Onshape authorization was denied.");
    if (params.get("onshape") === "error") setMessage(params.get("error") || "Onshape connection failed.");
    void load();
  }, [load]);

  async function revoke(deviceId: string) {
    if (!confirm("Revoke this CAD desktop? It will immediately lose job access.")) return;
    await fetch("/api/cad", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ orgId, action: "revoke-device", deviceId }),
    });
    await load();
  }

  async function connectOnshape() {
    setBusy(true);
    try {
      const response = await fetch("/api/cad/onshape", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ orgId, action: "authorize-url" }),
      });
      const data = await response.json();
      if (!response.ok) {
        setMessage(data.error ?? "Could not start Onshape");
        return;
      }
      window.location.href = data.url;
    } finally {
      setBusy(false);
    }
  }

  async function disconnectOnshape() {
    if (!confirm("Disconnect Onshape? Hosted CAD jobs stop until you reconnect.")) return;
    setBusy(true);
    try {
      const response = await fetch("/api/cad/onshape", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ orgId, action: "disconnect" }),
      });
      const data = await response.json();
      setMessage(response.ok ? "Onshape disconnected." : (data.error ?? "Could not disconnect Onshape"));
      if (response.ok) await load();
    } finally {
      setBusy(false);
    }
  }

  const failure =
    !view && fetchFailed
      ? loadFailureCopy(
          classifyLoadFailure({
            status: errorStatus,
            message,
            online: typeof navigator === "undefined" ? true : navigator.onLine,
          }),
          {
            nextPath:
              typeof window === "undefined"
                ? null
                : `${window.location.pathname}${window.location.search}`,
            message,
          },
        )
      : null;

  if (!view) {
    return (
      <main className="module-page cad-connections-page">
        <PageHeader
          breadcrumbs="CAD / Connections"
          title="CAD connections"
          description="Connect Onshape in the browser, or pair the Fusion desktop app."
        >
          <CadConnectionsRelated orgId={orgId} />
        </PageHeader>
        <OfflineBanner feature="CAD connections" fromCache={fromCache} cachedAt={cachedAt} />
        <EmptyState
          soft
          title={failure ? failure.title : "Loading CAD connections…"}
          description={failure ? failure.description : "Checking Onshape and paired desktops."}
          aria-busy={!fetchFailed}
        >
          {failure?.primary ? (
            <Button as="a" variant="primary" href={failure.primary.href}>
              {failure.primary.label}
            </Button>
          ) : null}
          {failure?.showRetry ? (
            <Button variant="secondary" type="button" onClick={() => void load()}>
              Retry
            </Button>
          ) : null}
        </EmptyState>
      </main>
    );
  }

  switch (view.status) {
    case "live": {
      const onshapeConnected = view.onshapeConnections.some((c) => c.status === "connected");
      const hostedBadge = onshapeHostedBadge({
        sessionConnected: onshapeConnected,
        oauthCtaEnabled: view.onshapeOauthReady,
      });
      const desktopOnline = view.devices.some((d) => !d.revokedAt && d.lastSeenAt);
      return (
        <main className="module-page cad-connections-page">
          <PageHeader
            breadcrumbs="CAD / Connections"
            title="CAD connections"
            description="Connect Onshape in the browser. Fusion stays on this computer."
          >
            <CadConnectionsRelated orgId={orgId} />
          </PageHeader>
          <OfflineBanner feature="CAD connections" fromCache={fromCache} cachedAt={cachedAt} />
          {message ? (
            <p role="status" className="telemetry-status">
              {message}
            </p>
          ) : null}
          {view.onshapeSetupMessage ? (
            <aside className="cad-setup-required" role="status">
              <strong>Onshape setup</strong>
              <p>{view.onshapeSetupMessage}</p>
            </aside>
          ) : null}
          <section className="cad-connection-strip">
            <article className="app-card cad-connection-tile" id="onshape">
              <div>
                <span className={`app-badge ${hostedBadge.kind === "connected" ? "good" : "setup"}`}>
                  {hostedBadge.label}
                </span>
                <h2>Onshape</h2>
                <p className="app-muted">
                  Authorize in the browser, then pick a document in CAD. Never type your Vantage password in a
                  terminal.
                </p>
              </div>
              {view.onshapeOauthReady ? (
                <>
                  <div className="cad-connection-actions">
                    <Button variant="primary" type="button" disabled={busy} onClick={() => void connectOnshape()}>
                      {onshapeConnected ? ONSHAPE_OAUTH_CTA.reconnect : ONSHAPE_OAUTH_CTA.connect}
                    </Button>
                    {onshapeConnected ? (
                      <Button variant="secondary" type="button" disabled={busy} onClick={() => void disconnectOnshape()}>
                        Disconnect
                      </Button>
                    ) : null}
                  </div>
                  <small className="app-muted">
                    {onshapeConnected
                      ? `Connected as ${
                          onshapeAccountLabel(view.onshapeConnections[0]?.externalAccountRef) ??
                          view.onshapeConnections[0]?.label ??
                          "Onshape"
                        }. Pick documents in CAD.`
                      : "Ready — tap Connect Onshape to authorize."}
                  </small>
                </>
              ) : (
                <p className="app-muted">{ONSHAPE_OAUTH_CTA.disabledDetail}</p>
              )}
            </article>
            <article className="app-card cad-connection-tile" id="fusion">
              <div>
                <span className={`app-badge ${desktopOnline ? "good" : "setup"}`}>
                  {desktopOnline ? "Paired" : "Not paired"}
                </span>
                <h2>Fusion desktop</h2>
                <p className="app-muted">
                  Fusion stays on this computer. Pair the desktop app when you need Autodesk jobs — Vantage never runs
                  Fusion in the cloud.
                </p>
              </div>
              <Button as="a" variant="secondary" href={withOrgHref("/cad/pair", orgId)}>
                Pair desktop
              </Button>
            </article>
          </section>
          <section className="app-card">
            <h2>Paired desktops</h2>
            {view.devices.length === 0 ? (
              <p className="app-muted">No desktop is paired.</p>
            ) : (
              view.devices.map((device) => (
                <article className="saved-board" key={device.id}>
                  <div>
                    <strong>{device.machineName}</strong>
                    <small>
                      {device.platform}
                      {device.lastSeenAt
                        ? ` · last seen ${new Date(device.lastSeenAt).toLocaleString()}`
                        : " · never seen"}
                      {device.revokedAt ? " · revoked" : ""}
                    </small>
                  </div>
                  {!device.revokedAt ? (
                    <Button variant="secondary" type="button" onClick={() => void revoke(device.id)}>
                      Revoke
                    </Button>
                  ) : null}
                </article>
              ))
            )}
          </section>
          <CadConnectionsNextActions
            orgId={orgId}
            onshapeConnected={onshapeConnected}
            hasDesktop={view.devices.some((d) => !d.revokedAt)}
          />
        </main>
      );
    }
    default: {
      const _never: never = view;
      return _never;
    }
  }
}
