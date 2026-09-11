"use client";

import { useCallback, useEffect, useState } from "react";
import { EmptyState, PageHeader, Panel } from "../../../components/ui";
import { OfflineBanner } from "../../../components/offline-banner";
import { Button } from "../../../components/ui/button";
import { useOfflineSnapshot } from "../../../lib/offline/use-offline-snapshot";

type ConnectorCard = {
  id: string;
  label: string;
  state: string;
  statusLine: string;
  callbackUrl?: string | null;
};

type RelayNode = {
  id: string;
  name: string;
  nodeVersion: string | null;
  queueDepth: number | null;
  tokensPerSecond: string | null;
  lastHeartbeatAt: string | null;
  roles: string[];
  instances: number | null;
  online: boolean;
};

export default function RelaysClient() {
  const [card, setCard] = useState<ConnectorCard | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [orgId, setOrgId] = useState("");
  const [pairCode, setPairCode] = useState("");
  const [pairName, setPairName] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");

  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get("orgId") ?? "";
    setOrgId(id);
    let cancelled = false;
    void fetch("/api/connectors")
      .then((response) => response.json())
      .then((body) => {
        if (cancelled) return;
        const found = (body.connectors as ConnectorCard[] | undefined)?.find((row) => row.id === "free-relay");
        setCard(found ?? null);
      })
      .catch(() => {
        if (!cancelled) setError("Could not load relay status.");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const fetchNodes = useCallback(async () => {
    const response = await fetch(`/api/relay/nodes?orgId=${encodeURIComponent(orgId)}`);
    const body = (await response.json()) as { nodes?: RelayNode[]; error?: string };
    if (!response.ok) throw new Error(body.error ?? "Could not load paired Pis.");
    return { nodes: body.nodes ?? [] };
  }, [orgId]);

  const snapshot = useOfflineSnapshot<{ nodes: RelayNode[] }>("relays", orgId, fetchNodes);
  const nodes = snapshot.data?.nodes ?? [];

  async function approve() {
    if (!orgId || busy) return;
    setBusy(true);
    setError(null);
    setNotice("");
    try {
      const response = await fetch("/api/relay/pair/approve", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ orgId, code: pairCode, name: pairName.trim() || undefined }),
      });
      const data = (await response.json()) as { success?: boolean; machineName?: string; error?: string };
      if (!response.ok || !data.success) {
        setError(data.error ?? "Pairing failed.");
        return;
      }
      setPairCode("");
      setNotice(`Paired ${data.machineName ?? "the Pi"}.`);
      await snapshot.refresh();
    } catch {
      setError("Could not approve that code.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="app-page">
      <PageHeader
        title="AI relays"
        description="Raspberry Pis that run Ask AI, Bugbot, assembly manuals, and video analysis. Pair one the same way you pair a storage node — a code on the Pi, approve it here."
      />
      {snapshot.offline ? (
        <OfflineBanner feature="AI relays" fromCache={Boolean(snapshot.cachedAt)} cachedAt={snapshot.cachedAt} />
      ) : null}
      {error ? <p className="app-muted">{error}</p> : null}
      {notice ? <p>{notice}</p> : null}
      {orgId ? (
        <Panel>
          <p>
            <strong>Approve a pairing code</strong>
          </p>
          <label>
            Code from the Pi
            <input value={pairCode} onChange={(event) => setPairCode(event.target.value)} placeholder="ABCD-EFGH" />
          </label>
          <label>
            Name (optional)
            <input value={pairName} onChange={(event) => setPairName(event.target.value)} placeholder="Shop Pi" />
          </label>
          <Button type="button" variant="primary" disabled={busy || !pairCode.trim()} onClick={() => void approve()}>
            {busy ? "Pairing…" : "Approve"}
          </Button>
        </Panel>
      ) : (
        <EmptyState
          badge="Setup required"
          badgeTone="setup"
          title="Choose your team"
          description="Open this page from Team so Vantage knows which shop the Pi belongs to."
        >
          <Button as="a" variant="primary" href="/workspace">
            Choose your team
          </Button>
        </EmptyState>
      )}
      {nodes.length ? (
        <Panel>
          <p>
            <strong>Paired Pis</strong>
          </p>
          <ul>
            {nodes.map((node) => (
              <li key={node.id}>
                <strong>{node.name}</strong>
                {" · "}
                {node.online ? "online" : "offline"}
                {node.roles.length ? ` · ${node.roles.join(", ")}` : ""}
                {node.instances ? ` · ${node.instances} instance${node.instances === 1 ? "" : "s"}` : ""}
                {node.queueDepth != null ? ` · queue ${node.queueDepth}` : ""}
                {node.tokensPerSecond ? ` · ${node.tokensPerSecond} tok/s` : ""}
              </li>
            ))}
          </ul>
        </Panel>
      ) : null}
      {card ? (
        <Panel>
          <p>
            <strong>{card.label}</strong>
          </p>
          <p>{card.statusLine}</p>
          {card.callbackUrl ? (
            <p>
              Poll URL to register on the Pi: <code>{card.callbackUrl}</code>
            </p>
          ) : null}
          <p className="app-muted">
            Do not paste a Freebuff website cookie. That is not allowed. Paste the relay endpoint and token the
            installer prints, or approve the pairing code.
          </p>
          <Button as="a" href="/connectors" variant="secondary">
            Open connectors
          </Button>
        </Panel>
      ) : (
        <EmptyState
          title="No relay paired"
          description="Install the worker on a Pi, then approve the pairing code. Chat goes to chat instances; long jobs go to agent; video analysis goes to video. When the video Pi is idle it can host agent instances too."
        >
          <Button as="a" href="/connectors" variant="primary">
            Open connectors
          </Button>
        </EmptyState>
      )}
    </div>
  );
}
