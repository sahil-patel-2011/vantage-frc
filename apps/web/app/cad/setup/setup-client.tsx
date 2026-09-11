"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { OfflineBanner } from "../../../components/offline-banner";
import { Button, EmptyState, PageHeader } from "../../../components/ui";
import {
  CAD_SETUP_ASK_MENTOR,
  CAD_SETUP_CONNECT,
  CAD_SETUP_DESCRIPTION,
  CAD_SETUP_FUSION,
  CAD_SETUP_ONSHAPE_READY,
  CAD_SETUP_RECONNECT,
  CAD_SETUP_TITLE,
} from "../../../lib/cad/cad-setup-copy";
import { onshapeAccountLabel, onshapeOauthCtaEnabled } from "../../../lib/cad/onshape-setup-strings";
import { FEATURE_API_TIMEOUT_MS } from "../../../lib/nav/resolve-org";
import { withOrgHref } from "../../../lib/nav/product-nav";
import { getFeatureSnapshot, putFeatureSnapshot, clearFeatureSnapshot } from "../../../lib/offline/feature-cache";
import { classifyLoadFailure, loadFailureCopy } from "../../../lib/ui/load-failure";
import { OnshapeEditBoard } from "../onshape-edit-board";

type CadTarget = "onshape" | "fusion360";
type Step = 1 | 2 | 3;

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

type CadSetupView = {
  status: "live";
  orgId: string;
  devices: Device[];
  onshapeReady: boolean;
  onshapeConnected: boolean;
  onshapeAccount: string | null;
};

function isCadSetupView(value: unknown): value is CadSetupView {
  if (!value || typeof value !== "object") return false;
  const row = value as { status?: unknown; orgId?: unknown; devices?: unknown };
  return row.status === "live" && typeof row.orgId === "string" && Array.isArray(row.devices);
}

function responseError(data: unknown): string {
  return data && typeof data === "object" && "error" in data && typeof data.error === "string"
    ? data.error
    : "";
}

async function persistCadSetupSnapshot(orgHint: string, data: CadSetupView): Promise<void> {
  const cacheOrg = data.orgId.trim() || orgHint;
  if (!cacheOrg) return;
  try {
    await putFeatureSnapshot("cad-setup", cacheOrg, data);
    if (!orgHint) await putFeatureSnapshot("cad-setup", "_", data);
  } catch {
    // Live CAD setup already painted; IndexedDB is best-effort.
  }
}

function stepLabel(step: Step): string {
  switch (step) {
    case 1:
      return "Where you design";
    case 2:
      return "Connect";
    case 3:
      return "Confirm";
    default: {
      const exhaustive: never = step;
      return exhaustive;
    }
  }
}

function targetLabel(target: CadTarget): string {
  switch (target) {
    case "onshape":
      return "Onshape";
    case "fusion360":
      return "Fusion";
    default: {
      const exhaustive: never = target;
      return exhaustive;
    }
  }
}

export function CadSetupRelated({ orgId }: { orgId: string | null }) {
  return (
    <nav className="product-hub-related" aria-label="Related CAD tools">
      <Button as="a" variant="secondary" href={withOrgHref("/cad", orgId)}>
        CAD
      </Button>
      <Button as="a" variant="secondary" href={withOrgHref("/cad/connections", orgId)}>
        CAD connections
      </Button>
      <Button as="a" variant="secondary" href={withOrgHref("/cad-vault", orgId)}>
        CAD Vault
      </Button>
    </nav>
  );
}

function CadSetupNextActions({
  orgId,
  onshapeConnected,
  hasDesktop,
}: {
  orgId: string;
  onshapeConnected: boolean;
  hasDesktop: boolean;
}) {
  const actions = [
    {
      id: "cad",
      label: "Open CAD",
      detail: onshapeConnected
        ? "Pick a document after Onshape is connected."
        : "Open CAD after you connect Onshape or pair Fusion.",
      href: withOrgHref("/cad", orgId),
      primary: true as const,
    },
    {
      id: "desktop",
      label: hasDesktop ? "Review paired computers" : "Pair Fusion",
      detail: CAD_SETUP_FUSION,
      href: withOrgHref("/cad/pair", orgId),
    },
  ];
  return (
    <section className="app-card soft-panel edc-next-actions cad-next-actions" aria-label="Next actions">
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

export default function CadSetupWizard({ orgId }: { orgId: string }) {
  const [view, setView] = useState<CadSetupView | null>(null);
  const [step, setStep] = useState<Step>(1);
  const [cadTarget, setCadTarget] = useState<CadTarget>("onshape");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [fetchFailed, setFetchFailed] = useState(false);
  const [errorStatus, setErrorStatus] = useState<number | null>(null);
  const [fromCache, setFromCache] = useState(false);
  const [cachedAt, setCachedAt] = useState<string | null>(null);
  const viewRef = useRef<CadSetupView | null>(null);
  viewRef.current = view;

  const load = useCallback(async () => {
    let hadCache = Boolean(viewRef.current);
    try {
      const cached = await getFeatureSnapshot<CadSetupView>("cad-setup", orgId || "_");
      if (!viewRef.current && cached?.data && isCadSetupView(cached.data)) {
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
        await clearFeatureSnapshot("cad-setup", orgId);
        await clearFeatureSnapshot("cad-setup", "_");
        setView(null);
        setFromCache(false);
        setCachedAt(null);
        setFetchFailed(true);
        setErrorStatus(response.status);
        setMessage(responseError(body) || "Could not load CAD setup.");
        return;
      }
      if (!response.ok || !body || typeof body !== "object") {
        if (hadCache || viewRef.current) {
          setFromCache(true);
          setMessage("Could not refresh CAD setup. Showing the last copy on this device.");
          setFetchFailed(false);
          return;
        }
        setFetchFailed(true);
        setErrorStatus(response.status);
        setMessage(responseError(body) || "Could not load CAD setup.");
        return;
      }
      const row = body as {
        devices?: Device[];
        onshape?: {
          configured?: boolean;
          redirectUri?: string | null;
          scopes?: unknown[] | null;
        };
        onshapeConnections?: OnshapeConnection[];
      };
      const onshapeReady = onshapeOauthCtaEnabled(row.onshape);
      const connections = Array.isArray(row.onshapeConnections) ? row.onshapeConnections : [];
      const connected = connections.find((item) => item.status === "connected");
      const next: CadSetupView = {
        status: "live",
        orgId,
        devices: Array.isArray(row.devices) ? row.devices : [],
        onshapeReady,
        onshapeConnected: Boolean(connected),
        onshapeAccount: onshapeAccountLabel(connected?.externalAccountRef) ?? connected?.label ?? null,
      };
      setView(next);
      setFromCache(false);
      setCachedAt(null);
      setMessage("");
      await persistCadSetupSnapshot(orgId, next);
    } catch {
      if (hadCache || viewRef.current) {
        setFromCache(true);
        setMessage("Could not refresh CAD setup. Showing the last copy on this device.");
        setFetchFailed(false);
        return;
      }
      setFetchFailed(true);
      setMessage("Could not load CAD setup.");
    }
  }, [orgId]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("onshape") === "connected") setMessage("Onshape connected.");
    if (params.get("onshape") === "denied") setMessage("Onshape authorization was denied.");
    if (params.get("onshape") === "error") setMessage(params.get("error") || "Onshape connection failed.");
    void load();
    const timer = setInterval(() => {
      if (document.visibilityState === "hidden") return;
      void load();
    }, 8000);
    return () => clearInterval(timer);
  }, [load]);

  async function connectOnshape() {
    setBusy(true);
    try {
      const response = await fetch("/api/cad/onshape", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ orgId, action: "authorize-url" }),
      });
      const data: unknown = await response.json().catch(() => null);
      if (!response.ok) {
        setMessage(responseError(data) || "Could not start Onshape.");
        return;
      }
      const url =
        data && typeof data === "object" && "url" in data && typeof data.url === "string" ? data.url : "";
      if (!url) {
        setMessage("Could not start Onshape.");
        return;
      }
      window.location.href = url;
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

  const chooseTeam = errorStatus === 401 || errorStatus === 403;

  if (!view) {
    return (
      <main className="module-page cad-setup-page">
        <PageHeader
          breadcrumbs="CAD / Setup"
          title={CAD_SETUP_TITLE}
          description={CAD_SETUP_DESCRIPTION}
        >
          <CadSetupRelated orgId={orgId} />
        </PageHeader>
        <OfflineBanner feature="CAD setup" fromCache={fromCache} cachedAt={cachedAt} />
        <EmptyState
          soft
          badge={chooseTeam ? "Needs setup" : undefined}
          badgeTone={chooseTeam ? "setup" : undefined}
          title={chooseTeam ? "Choose your team" : failure ? failure.title : "Loading CAD setup…"}
          description={
            chooseTeam
              ? "Choose your team to connect Onshape or pair Fusion."
              : failure
                ? failure.description
                : "Checking Onshape and paired computers."
          }
          aria-busy={!fetchFailed}
        >
          {chooseTeam ? (
            <Button as="a" variant="primary" href="/workspace">
              Choose your team
            </Button>
          ) : failure?.primary ? (
            <Button as="a" variant="primary" href={failure.primary.href}>
              {failure.primary.label}
            </Button>
          ) : null}
          {failure?.showRetry && !chooseTeam ? (
            <Button variant="secondary" type="button" onClick={() => void load()}>
              Retry
            </Button>
          ) : null}
        </EmptyState>
      </main>
    );
  }

  const desktopOnline = view.devices.some((device) => !device.revokedAt && device.lastSeenAt);
  const q = `?orgId=${encodeURIComponent(orgId)}`;

  return (
    <main className="module-page cad-setup-page">
      <PageHeader breadcrumbs="CAD / Setup" title={CAD_SETUP_TITLE} description={CAD_SETUP_DESCRIPTION}>
        <CadSetupRelated orgId={orgId} />
      </PageHeader>
      <OfflineBanner feature="CAD setup" fromCache={fromCache} cachedAt={cachedAt} />
      {message ? (
        <p className="telemetry-status" role="status">
          {message}
        </p>
      ) : null}

      {!view.onshapeReady && cadTarget === "onshape" ? (
        <aside className="cad-setup-required" role="status">
          <strong>Needs setup</strong>
          <p>{CAD_SETUP_ASK_MENTOR}</p>
        </aside>
      ) : null}

      <OnshapeEditBoard />

      <ol className="cad-setup-steps" aria-label="CAD setup progress">
        {([1, 2, 3] as const).map((n) => (
          <li key={n} className={n < step ? "active" : undefined} aria-current={n === step ? "step" : undefined}>
            <b>{n}</b>
            <span>{stepLabel(n)}</span>
          </li>
        ))}
      </ol>

      {step === 1 ? (
        <section className="cad-setup-panel">
          <h2>1. Where you design</h2>
          <p className="app-muted" style={{ margin: 0 }}>
            Onshape is the live path in the browser. Fusion stays on this computer.
          </p>
          <label className="cad-choice">
            <input
              type="radio"
              name="cad"
              checked={cadTarget === "onshape"}
              onChange={() => setCadTarget("onshape")}
            />
            <span>
              <strong>Onshape (recommended)</strong>
              <small>{view.onshapeReady ? CAD_SETUP_ONSHAPE_READY : CAD_SETUP_ASK_MENTOR}</small>
            </span>
          </label>
          <label className="cad-choice">
            <input
              type="radio"
              name="cad"
              checked={cadTarget === "fusion360"}
              onChange={() => setCadTarget("fusion360")}
            />
            <span>
              <strong>Fusion on this computer</strong>
              <small>{CAD_SETUP_FUSION}</small>
            </span>
          </label>
          <div className="cad-setup-actions">
            <Button variant="primary" type="button" onClick={() => setStep(2)}>
              Continue
            </Button>
          </div>
        </section>
      ) : null}

      {step === 2 ? (
        <section className="cad-setup-panel">
          <h2>2. Connect {targetLabel(cadTarget)}</h2>
          {cadTarget === "onshape" ? (
            view.onshapeReady ? (
              <>
                <p className="app-muted" style={{ margin: 0 }}>
                  {CAD_SETUP_ONSHAPE_READY}
                </p>
                <div className="cad-setup-actions">
                  <Button variant="primary" type="button" disabled={busy} onClick={() => void connectOnshape()}>
                    {view.onshapeConnected ? CAD_SETUP_RECONNECT : CAD_SETUP_CONNECT}
                  </Button>
                  <Button variant="secondary" type="button" onClick={() => setStep(1)}>
                    Back
                  </Button>
                  <Button variant="secondary" type="button" onClick={() => setStep(3)}>
                    Continue
                  </Button>
                </div>
              </>
            ) : (
              <>
                <p className="app-muted" style={{ margin: 0 }}>
                  {CAD_SETUP_ASK_MENTOR}
                </p>
                <div className="cad-setup-actions">
                  <Button variant="primary" type="button" onClick={() => setStep(3)}>
                    Continue
                  </Button>
                  <Button variant="secondary" type="button" onClick={() => setStep(1)}>
                    Back
                  </Button>
                </div>
              </>
            )
          ) : (
            <>
              <p className="app-muted" style={{ margin: 0 }}>
                {CAD_SETUP_FUSION}
              </p>
              <div className="cad-setup-actions">
                <Button as="a" variant="primary" href={`/cad/pair${q}`}>
                  Pair this computer
                </Button>
                <Button variant="secondary" type="button" onClick={() => setStep(1)}>
                  Back
                </Button>
                <Button variant="secondary" type="button" onClick={() => setStep(3)}>
                  Continue
                </Button>
              </div>
            </>
          )}
        </section>
      ) : null}

      {step === 3 ? (
        <section className="cad-setup-panel">
          <h2>3. Confirm</h2>
          {cadTarget === "onshape" ? (
            <p role="status" className="telemetry-status">
              {view.onshapeConnected
                ? `Onshape is connected${view.onshapeAccount ? ` as ${view.onshapeAccount}` : ""}.`
                : view.onshapeReady
                  ? "Onshape is ready — connect in the browser to finish."
                  : CAD_SETUP_ASK_MENTOR}
            </p>
          ) : desktopOnline ? (
            <p role="status" className="telemetry-status">
              Paired computer online:{" "}
              {view.devices.find((device) => !device.revokedAt && device.lastSeenAt)?.machineName ?? "this computer"}
            </p>
          ) : (
            <p role="status" className="telemetry-status">
              Waiting for a paired computer. Open Pair this computer if setup is unfinished.
            </p>
          )}
          <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13 }}>
            {view.devices.length === 0 ? <li>No computer is paired yet.</li> : null}
            {view.devices.map((device) => (
              <li key={device.id}>
                {device.machineName} · {device.platform} ·{" "}
                {device.revokedAt
                  ? "revoked"
                  : device.lastSeenAt
                    ? `seen ${new Date(device.lastSeenAt).toLocaleString()}`
                    : "never seen"}
              </li>
            ))}
          </ul>
          <div className="cad-setup-actions">
            <Button variant="secondary" type="button" onClick={() => setStep(2)}>
              Back
            </Button>
            <Button as="a" variant="primary" href={`/cad${q}`}>
              Open CAD
            </Button>
          </div>
        </section>
      ) : null}

      {step === 3 ? (
        <CadSetupNextActions
          orgId={orgId}
          onshapeConnected={view.onshapeConnected}
          hasDesktop={view.devices.some((device) => !device.revokedAt)}
        />
      ) : null}
    </main>
  );
}
