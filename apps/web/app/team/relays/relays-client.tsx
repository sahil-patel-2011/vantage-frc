"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { EmptyState, PageHeader, Button } from "../../../components/ui";
import { OfflineBanner } from "../../../components/offline-banner";
import {
  FEATURE_API_TIMEOUT_MS,
  fetchActiveOrgId,
  persistOrgIdInUrl,
  readOrgIdFromSearch,
} from "../../../lib/nav/resolve-org";
import { useOfflineSnapshot } from "../../../lib/offline/use-offline-snapshot";
import {
  RELAYS_PAGE_DESCRIPTION,
  classifyRelaysShell,
  relaysNextActions,
  relaysShellCopy,
  type RelaysSnapshot,
} from "../../../lib/relays/relays-related";
import {
  RelaysNextActionsPanel,
  RelaysNodeList,
  RelaysPasteForm,
  RelaysRelatedStrip,
  RelaysShell,
} from "./relays-chrome";

export default function RelaysClient() {
  const [orgId, setOrgId] = useState("");
  const [orgReady, setOrgReady] = useState(false);

  useEffect(() => {
    const fromUrl = readOrgIdFromSearch(window.location.search);
    if (fromUrl) {
      setOrgId(fromUrl);
      setOrgReady(true);
      return;
    }
    void fetchActiveOrgId().then((id) => {
      if (id) {
        persistOrgIdInUrl(id);
        setOrgId(id);
      }
      setOrgReady(true);
    });
  }, []);

  if (!orgReady) {
    return <RelaysShell orgId={null} shell="loading" />;
  }
  if (!orgId) {
    return <RelaysShell orgId={null} shell="setup" />;
  }
  return <RelaysLive orgId={orgId} />;
}

function RelaysLive({ orgId }: { orgId: string }) {
  const [token, setToken] = useState("");
  const [name, setName] = useState("");
  const [message, setMessage] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [fetchFailed, setFetchFailed] = useState(false);
  const [errorStatus, setErrorStatus] = useState<number | null>(null);

  const fetchNodes = useCallback(async (): Promise<RelaysSnapshot> => {
    setFetchFailed(false);
    setErrorStatus(null);
    const response = await fetch(`/api/relay/nodes?orgId=${encodeURIComponent(orgId)}`, {
      cache: "no-store",
      signal: AbortSignal.timeout(FEATURE_API_TIMEOUT_MS),
    });
    const data = (await response.json()) as RelaysSnapshot & { error?: string };
    if (!response.ok) {
      setFetchFailed(true);
      setErrorStatus(response.status);
      throw new Error(data.error ?? "Could not load AI relays.");
    }
    return { nodes: data.nodes ?? [] };
  }, [orgId]);

  const snapshot = useOfflineSnapshot<RelaysSnapshot>("relays", orgId, fetchNodes);
  const nodes = snapshot.data?.nodes ?? [];
  const shell = classifyRelaysShell({
    loading: snapshot.loading && nodes.length === 0,
    fetchFailed: fetchFailed && nodes.length === 0,
    orgId,
    nodeCount: nodes.length,
    errorStatus,
  });
  const shellCopy = relaysShellCopy(shell);
  const nextActions = relaysNextActions({
    orgId,
    shell,
    nodeCount: nodes.length,
  });

  async function saveToken(event: FormEvent) {
    event.preventDefault();
    if (!orgId || busy) return;
    setBusy(true);
    setMessage("");
    setNotice("");
    try {
      const response = await fetch("/api/relay/pair/approve", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ orgId, code: token, name: name.trim() || undefined }),
        signal: AbortSignal.timeout(FEATURE_API_TIMEOUT_MS),
      });
      const data = (await response.json()) as { success?: boolean; machineName?: string; error?: string };
      if (!response.ok || !data.success) {
        setMessage(data.error ?? "Could not save that token.");
        return;
      }
      setToken("");
      setNotice(`Connected ${data.machineName ?? "the Pi"}.`);
      await snapshot.refresh();
    } catch {
      setMessage("Could not save that token.");
    } finally {
      setBusy(false);
    }
  }

  if (shell === "loading" || shell === "error" || shell === "setup") {
    return (
      <RelaysShell
        orgId={orgId}
        shell={shell}
        error={shell === "error" ? shellCopy.description : undefined}
        errorStatus={errorStatus}
        onRetry={() => void snapshot.refresh()}
      >
        <OfflineBanner feature="AI relays" fromCache={Boolean(snapshot.cachedAt)} cachedAt={snapshot.cachedAt} />
      </RelaysShell>
    );
  }

  return (
    <div className="app-page relays-page">
      <PageHeader
        breadcrumbs="Team / AI relays"
        title="AI relays"
        description={RELAYS_PAGE_DESCRIPTION}
      >
        <RelaysRelatedStrip orgId={orgId} />
      </PageHeader>
      {snapshot.offline ? (
        <OfflineBanner feature="AI relays" fromCache={Boolean(snapshot.cachedAt)} cachedAt={snapshot.cachedAt} />
      ) : null}
      {shell === "ready" ? <RelaysNextActionsPanel actions={nextActions} /> : null}
      <RelaysPasteForm
        token={token}
        name={name}
        busy={busy}
        message={message}
        notice={notice}
        onToken={setToken}
        onName={setName}
        onSave={(event) => void saveToken(event)}
      />
      {shell === "empty" ? (
        <EmptyState
          soft
          badge={shellCopy.badge}
          badgeTone="setup"
          title={shellCopy.title}
          description={shellCopy.description}
        >
          <Button as="a" variant="primary" href="#relay-paste">
            Paste this token
          </Button>
        </EmptyState>
      ) : (
        <RelaysNodeList nodes={nodes} />
      )}
    </div>
  );
}
