"use client";

import { useCallback, useEffect, useState } from "react";
import { Badge, Button, Skeleton } from "../../components/ui";
import { ONSHAPE_OFF_COPY, onshapeCheckState, type OnshapeCheckState, type OnshapeStatusPayload } from "../../lib/cad-checker/onshape-state";
import { FEATURE_API_TIMEOUT_MS, fetchActiveOrgId, readOrgIdFromSearch } from "../../lib/nav/resolve-org";

type Load =
  | { phase: "loading" }
  | { phase: "ready"; state: OnshapeCheckState; orgId: string | null; problem: string | null };

/** The team in the address bar, else the active team from /api/me. */
async function resolveOrg(): Promise<string | null> {
  const fromUrl = readOrgIdFromSearch(window.location.search);
  return fromUrl ?? (await fetchActiveOrgId().catch(() => null));
}

/**
 * Onshape part checks (features, mass, drawings) need Vantage to read the student's Onshape. This
 * says which of three places they are in, from the real configuration and their own connection:
 * Onshape off for the deployment, on but not connected, or connected.
 */
export function OnshapeChecks({ configured }: { configured: boolean }) {
  const [load, setLoad] = useState<Load>(configured ? { phase: "loading" } : { phase: "ready", state: "off", orgId: null, problem: null });
  const [connecting, setConnecting] = useState(false);
  const [connectError, setConnectError] = useState("");

  const read = useCallback(async () => {
    if (!configured) return;
    setLoad({ phase: "loading" });
    const orgId = await resolveOrg();
    if (!orgId) {
      setLoad({ phase: "ready", state: "unknown", orgId: null, problem: "Choose your team to see your Onshape checks." });
      return;
    }
    const response = await fetch(`/api/cad/onshape?orgId=${encodeURIComponent(orgId)}`, {
      cache: "no-store",
      signal: AbortSignal.timeout(FEATURE_API_TIMEOUT_MS),
    }).catch(() => null);
    const data = response?.ok ? ((await response.json().catch(() => null)) as OnshapeStatusPayload | null) : null;
    const problem = !response
      ? "Couldn't reach Vantage to check your Onshape connection."
      : response.status === 401
        ? "Sign in to see your Onshape checks."
        : !data
          ? "Couldn't check your Onshape connection."
          : null;
    setLoad({ phase: "ready", state: onshapeCheckState(configured, data), orgId, problem });
  }, [configured]);

  useEffect(() => {
    void read();
  }, [read]);

  async function connect(orgId: string) {
    setConnecting(true);
    setConnectError("");
    try {
      const response = await fetch("/api/cad/onshape", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ orgId, action: "authorize-url" }),
        signal: AbortSignal.timeout(FEATURE_API_TIMEOUT_MS),
      }).catch(() => null);
      const data = response ? ((await response.json().catch(() => null)) as { url?: string; error?: string } | null) : null;
      if (response?.ok && typeof data?.url === "string") {
        window.location.href = data.url;
        return;
      }
      setConnectError(data?.error ?? "Couldn't start connecting Onshape. Try again.");
    } finally {
      setConnecting(false);
    }
  }

  return (
    <section className="cad-checker-section" aria-labelledby="cad-checker-onshape" aria-busy={load.phase === "loading"}>
      <div className="cad-checker-section-head">
        <h2 id="cad-checker-onshape">Onshape part checks</h2>
        <p>Vantage reads your own Onshape part to check its features, mass and drawings. It only reads; it never changes your CAD.</p>
      </div>

      {load.phase === "loading" ? (
        <div className="cad-checker-onshape" role="status">
          <span className="sr-only">Checking your Onshape connection</span>
          <Skeleton width="30%" height={16} />
          <Skeleton width="70%" height={14} />
        </div>
      ) : load.state === "off" ? (
        <div className="cad-checker-onshape" data-testid="onshape-off">
          <Badge tone="setup">Needs setup</Badge>
          <p>{ONSHAPE_OFF_COPY}</p>
          <p className="cad-checker-links">
            <a href="/learn/guided">Guided Onshape tracks</a>, where a lead signs steps off
          </p>
        </div>
      ) : load.state === "connect" && load.orgId ? (
        <div className="cad-checker-onshape" data-testid="onshape-connect">
          <Badge tone="setup">Not connected</Badge>
          <p>Connect your Onshape account so Vantage can check your parts in Learn CAD and the guided tracks.</p>
          <div className="cad-checker-actions">
            <Button variant="secondary" disabled={connecting} onClick={() => void connect(load.orgId!)}>
              {connecting ? "Opening Onshape…" : "Connect Onshape"}
            </Button>
          </div>
          {connectError ? (
            <p className="cad-checker-error" role="alert">
              {connectError}
            </p>
          ) : null}
        </div>
      ) : load.state === "connected" ? (
        <div className="cad-checker-onshape" data-testid="onshape-connected">
          <Badge tone="good">Connected</Badge>
          <p>Your Onshape is connected. Run a check where you&apos;re working:</p>
          <ul className="cad-checker-link-list">
            <li>
              <a href="/cad-learn">Learn CAD</a>: grade a part&apos;s mass and spin against your team&apos;s reference
            </li>
            <li>
              <a href="/learn/guided">Guided Onshape tracks</a>: each step checks your Part Studio, assembly or drawing
            </li>
          </ul>
        </div>
      ) : (
        <div className="cad-checker-onshape" data-testid="onshape-unknown">
          {/* Signed out or no team is something to do, not a failure; only a failed read is red. */}
          {load.problem?.startsWith("Couldn") ? <Badge tone="error">Couldn&apos;t check</Badge> : <Badge tone="setup">Needs setup</Badge>}
          <p>{load.problem ?? "Couldn't check your Onshape connection."}</p>
          <div className="cad-checker-actions">
            {load.problem?.startsWith("Sign in") ? (
              <Button as="a" variant="secondary" href={`/signin?next=${encodeURIComponent("/cad-checker")}`}>
                Sign in
              </Button>
            ) : load.problem?.startsWith("Choose your team") ? (
              <Button as="a" variant="secondary" href="/workspace">
                Choose your team
              </Button>
            ) : (
              <Button variant="secondary" onClick={() => void read()}>
                Retry
              </Button>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
