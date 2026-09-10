"use client";

// Self-hosted storage nodes — pair a Raspberry Pi (or any always-on computer) so large files
// live on the team's own hardware and the hosted database never maxes out.
//
// Honesty rules on this page: liveness is derived from heartbeats (>5 min gap = degraded,
// >30 min = offline), disk numbers appear only after a real heartbeat, and items a node's own
// scrub could not find are labelled missing. Nothing is simulated.

import { useCallback, useEffect, useState } from "react";
import {
  Badge,
  type BadgeTone,
  Button,
  EmptyState,
  ErrorState,
  PageHeader,
  Panel,
  SoftBlockSkeleton,
  StatTile,
  relativeTime,
} from "../../../components/ui";
import { LIVENESS_LABEL, formatBytes, type NodeLiveness } from "../../../lib/storage-node";
import type {
  StorageNodeCard,
  StorageNodeViewData,
} from "../../../lib/storage-node/compute-storage-view";
import "./storage.css";

const LIVENESS_TONE: Record<NodeLiveness, BadgeTone> = {
  online: "good",
  degraded: "setup",
  offline: "danger",
  never: "neutral",
};

const DESCRIPTION =
  "Pair an always-on computer (a Raspberry Pi works well) that stores your team's large files itself — only metadata stays in the hosted database.";

function SetupInstructions() {
  return (
    <Panel className="stn-panel">
      <h2>Run a storage node</h2>
      <p className="app-muted stn-note">
        On the computer that will store files (Node.js 20+ required), download <code>server.mjs</code> from the
        Vantage repo (<code>packages/storage-node</code>), then pair and start it:
      </p>
      <pre className="stn-code">
        {`node server.mjs --setup --cloud ${typeof window !== "undefined" ? window.location.origin : "https://your-vantage-host"}
node server.mjs # after pairing; add --quota-gb to change the 20 GB default`}
      </pre>
      <p className="app-muted stn-note">
        The node prints an 8-character code — enter it below. On your shop/pit network the node serves files
        directly. To reach it from anywhere, give it a public URL with Tailscale Funnel or cloudflared and save
        that URL on the node card here. Without one, the cloud cannot reach a node behind your router — items
        will honestly show as unreachable away from the LAN. Full guide: <code>docs/STORAGE_NODE.md</code>.
      </p>
    </Panel>
  );
}

function StorageShell({
  kind,
  message,
  onRetry,
}: {
  kind: "loading" | "error" | "setup";
  message?: string;
  onRetry?: () => void;
}) {
  return (
    <main className="module-page stn-page soft-gate">
      <PageHeader
        breadcrumbs={
          <>
            <a href="/team">Team</a>
            {" / Storage"}
          </>
        }
        title="Self-hosted storage"
        description={DESCRIPTION}
      />
      {kind === "loading" ? (
        <div aria-busy="true" aria-label="Loading storage nodes">
          <SoftBlockSkeleton lines={4} />
        </div>
      ) : kind === "error" ? (
        <ErrorState message={message ?? "Could not load storage nodes."} onRetry={onRetry} />
      ) : (
        <EmptyState
          soft
          badge="Setup required"
          badgeTone="setup"
          title="Select a team"
          description={message ?? "Select a team to manage self-hosted storage."}
        >
          <a className="app-button" href="/workspace">
            Choose your team
          </a>
        </EmptyState>
      )}
    </main>
  );
}

function DiskLine({ node }: { node: StorageNodeCard }) {
  if (node.diskTotalBytes == null || node.diskFreeBytes == null) {
    return <span className="app-muted">Disk: unknown until the node&apos;s first heartbeat</span>;
  }
  return (
    <span>
      Disk: {formatBytes(node.diskFreeBytes)} free of {formatBytes(node.diskTotalBytes)}
    </span>
  );
}

function NodeCard({
  node,
  busy,
  onManage,
}: {
  node: StorageNodeCard;
  busy: boolean;
  onManage: (payload: Record<string, unknown>) => void;
}) {
  const [baseUrlDraft, setBaseUrlDraft] = useState(node.baseUrl ?? "");
  const [confirmUnpair, setConfirmUnpair] = useState(false);

  return (
    <li className="stn-node">
      <div className="stn-node-head">
        <div className="stn-node-title">
          <strong>{node.name}</strong>
          <Badge tone={LIVENESS_TONE[node.liveness]}>{LIVENESS_LABEL[node.liveness]}</Badge>
        </div>
        <span className="app-muted">
          {node.lastHeartbeatAt
            ? `Last heartbeat ${relativeTime(node.lastHeartbeatAt)}`
            : "No heartbeat received yet — start the node with `node server.mjs`"}
        </span>
      </div>

      <div className="stn-node-facts">
        <DiskLine node={node} />
        <span>
          {node.itemCount} item{node.itemCount === 1 ? "" : "s"} · {formatBytes(node.storedBytes)} stored
          {node.missingCount > 0 ? (
            <>
              {" · "}
              <span className="stn-missing">{node.missingCount} reported missing by the node</span>
            </>
          ) : null}
        </span>
        {node.nodeVersion ? <span className="app-muted">node v{node.nodeVersion}</span> : null}
        {node.lanAddresses.length > 0 ? (
          <span className="app-muted">LAN (same network only): {node.lanAddresses.join(", ")}</span>
        ) : null}
      </div>

      {node.canManage ? (
        <div className="stn-node-manage">
          <form
            className="stn-inline-form"
            onSubmit={(event) => {
              event.preventDefault();
              onManage({ action: "set-base-url", nodeId: node.id, baseUrl: baseUrlDraft.trim() || null });
            }}
          >
            <label>
              Reachable URL (optional)
              <input
                type="url"
                placeholder="https://your-node.tail1234.ts.net"
                value={baseUrlDraft}
                onChange={(event) => setBaseUrlDraft(event.target.value)}
              />
            </label>
            <Button type="submit" disabled={busy}>
              Save URL
            </Button>
            {node.baseUrl ? null : (
              <span className="app-muted stn-url-hint">
                Without a reachable URL, files on this node can only be fetched from its own network.
              </span>
            )}
          </form>
          <div className="stn-node-actions">
            {confirmUnpair ? (
              <>
                <span className="stn-missing">Unpair “{node.name}”? Its token is revoked; registered items become unreachable.</span>
                <Button variant="danger" disabled={busy} onClick={() => onManage({ action: "unpair", nodeId: node.id })}>
                  Yes, unpair
                </Button>
                <Button variant="ghost" onClick={() => setConfirmUnpair(false)}>
                  Cancel
                </Button>
              </>
            ) : (
              <Button variant="ghost" disabled={busy} onClick={() => setConfirmUnpair(true)}>
                Unpair node
              </Button>
            )}
          </div>
        </div>
      ) : null}
    </li>
  );
}

export default function StorageNodesClient() {
  const [view, setView] = useState<StorageNodeViewData | null>(null);
  const [fetchFailed, setFetchFailed] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [pairCode, setPairCode] = useState("");
  const [pairName, setPairName] = useState("");

  const load = useCallback(() => {
    setFetchFailed(false);
    const params = new URLSearchParams(window.location.search);
    const urlOrg = params.get("orgId");
    const query = urlOrg ? `?orgId=${encodeURIComponent(urlOrg)}` : "";
    void fetch(`/api/storage-node${query}`)
      .then(async (response) => {
        const data = (await response.json()) as StorageNodeViewData | { error?: string };
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

  // Heartbeats land every 60s; refresh at the same cadence so liveness stays honest on screen.
  useEffect(() => {
    const timer = window.setInterval(() => {
      if (document.visibilityState === "hidden") return;
      load();
    }, 60_000);
    return () => window.clearInterval(timer);
  }, [load]);

  const orgId = view && "orgId" in view ? view.orgId : null;

  const manage = useCallback(
    async (payload: Record<string, unknown>) => {
      if (!orgId || busy) return;
      setBusy(true);
      setError("");
      setNotice("");
      try {
        const response = await fetch("/api/storage-node", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ orgId, ...payload }),
        });
        const data = (await response.json()) as StorageNodeViewData | { error?: string };
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

  const approvePairing = useCallback(async () => {
    if (!orgId || busy || !pairCode.trim()) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const response = await fetch("/api/storage-node/pair/approve", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ orgId, code: pairCode, name: pairName.trim() || undefined }),
      });
      const data = (await response.json()) as { success?: boolean; machineName?: string; error?: string };
      if (!response.ok || !data.success) {
        setError(data.error ?? "Pairing failed.");
        return;
      }
      setNotice(
        `Paired "${data.machineName ?? "storage node"}". The node picks up its token within a few seconds and sends its first heartbeat within a minute.`,
      );
      setPairCode("");
      setPairName("");
      load();
    } catch {
      setError("Network error — please try again.");
    } finally {
      setBusy(false);
    }
  }, [orgId, busy, pairCode, pairName, load]);

  if (view == null && !fetchFailed) return <StorageShell kind="loading" />;
  if (fetchFailed) return <StorageShell kind="error" message="Could not load storage nodes." onRetry={load} />;
  if (view == null || view.status !== "live") {
    return <StorageShell kind="setup" message={view?.status === "setup_required" ? view.message : undefined} />;
  }

  return (
    <main className="module-page stn-page">
      <PageHeader
        breadcrumbs={
          <>
            <a href="/team">Team</a>
            {" / Storage"}
          </>
        }
        title="Self-hosted storage"
        description={DESCRIPTION}
      />

      {error ? (
        <p className="telemetry-status" role="alert">
          {error}
        </p>
      ) : null}
      {notice ? <p className="stn-notice" role="status">{notice}</p> : null}

      {view.nodes.length > 0 ? (
        <Panel className="stn-panel">
          <div className="stn-stats">
            <StatTile label="Nodes" value={String(view.summary.nodeCount)} />
            <StatTile label="Online now" value={String(view.summary.onlineCount)} />
            <StatTile label="Items" value={String(view.summary.itemCount)} />
            <StatTile label="Stored" value={formatBytes(view.summary.storedBytes)} />
            {view.summary.missingCount > 0 ? (
              <StatTile label="Missing on nodes" value={String(view.summary.missingCount)} />
            ) : null}
          </div>
          <ul className="stn-list">
            {view.nodes.map((node) => (
              <NodeCard key={node.id} node={node} busy={busy} onManage={manage} />
            ))}
          </ul>
        </Panel>
      ) : (
        <SetupInstructions />
      )}

      <Panel className="stn-panel">
        <h2>Pair a node</h2>
        <p className="app-muted stn-note">
          Run <code>node server.mjs --setup --cloud {typeof window !== "undefined" ? window.location.origin : "…"}</code>{" "}
          on the node, then enter the 8-character code it prints. Owners and admins can approve pairings.
        </p>
        <form
          className="stn-inline-form"
          onSubmit={(event) => {
            event.preventDefault();
            void approvePairing();
          }}
        >
          <label>
            Pairing code
            <input
              value={pairCode}
              onChange={(event) => setPairCode(event.target.value)}
              placeholder="ABCD-EFGH"
              autoComplete="off"
              spellCheck={false}
            />
          </label>
          <label>
            Node name (optional)
            <input
              value={pairName}
              onChange={(event) => setPairName(event.target.value)}
              placeholder="pi-shop"
              maxLength={100}
            />
          </label>
          <Button type="submit" disabled={busy || !pairCode.trim()}>
            Approve pairing
          </Button>
        </form>
      </Panel>

      {view.nodes.length > 0 ? <SetupInstructions /> : null}

      {view.recentItems.length > 0 ? (
        <Panel className="stn-panel">
          <h2>Recent items</h2>
          <ul className="stn-list">
            {view.recentItems.map((item) => {
              const node = view.nodes.find((candidate) => candidate.id === item.nodeId);
              const unreachable = node && node.liveness !== "online";
              return (
                <li key={item.id} className="stn-item">
                  <span className="stn-item-main">
                    <code className="stn-sha" title={item.sha256}>
                      {item.sha256.slice(0, 12)}…
                    </code>{" "}
                    {formatBytes(item.byteSize)} · {item.contentType}
                  </span>
                  <span className="app-muted">
                    {item.status === "missing"
                      ? `Reported missing by ${item.nodeName}`
                      : unreachable
                        ? `Stored on ${item.nodeName}, currently unreachable — last seen ${
                            node?.lastHeartbeatAt ? relativeTime(node.lastHeartbeatAt) : "never"
                          }`
                        : `Stored on ${item.nodeName}`}
                  </span>
                </li>
              );
            })}
          </ul>
        </Panel>
      ) : null}

      <p className="app-muted stn-note">
        Liveness comes from the node&apos;s 60-second heartbeats: a gap over 5 minutes shows degraded, over 30
        minutes offline. Disk numbers are what the node last reported — never an estimate.
      </p>
    </main>
  );
}
