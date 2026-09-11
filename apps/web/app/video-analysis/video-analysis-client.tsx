"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { OfflineBanner } from "../../components/offline-banner";
import { EmptyState, PageHeader } from "../../components/ui";
import {
  FEATURE_API_TIMEOUT_MS,
  fetchActiveOrgId,
  persistOrgIdInUrl,
  readOrgIdFromSearch,
} from "../../lib/nav/resolve-org";
import { useOfflineSnapshot } from "../../lib/offline/use-offline-snapshot";
import {
  VIDEO_PAGE_DESCRIPTION,
  classifyVideoAnalysisShell,
  pendingVideoConfirmCount,
  videoAnalysisNextActions,
  videoAnalysisShellCopy,
  type VideoAnalysisSnapshot,
  type VideoSourceKind,
} from "../../lib/video-analysis/video-analysis-related";
import { VideoAnalysisShell, VideoNextActionsPanel, VideoRelatedStrip } from "./video-analysis-chrome";
import { VideoPasteForm, VideoQueueList } from "./video-analysis-queue";

export default function VideoAnalysisClient() {
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
    return <VideoAnalysisShell orgId={null} shell="loading" />;
  }
  if (!orgId) {
    return <VideoAnalysisShell orgId={null} shell="setup" />;
  }
  return <VideoAnalysisLive orgId={orgId} />;
}

function VideoAnalysisLive({ orgId }: { orgId: string }) {
  const [sourceRef, setSourceRef] = useState("");
  const [sourceKind, setSourceKind] = useState<VideoSourceKind>("youtube");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [fetchFailed, setFetchFailed] = useState(false);
  const [errorStatus, setErrorStatus] = useState<number | null>(null);

  const fetchJobs = useCallback(async (): Promise<VideoAnalysisSnapshot> => {
    setFetchFailed(false);
    setErrorStatus(null);
    const response = await fetch(`/api/video-analysis?orgId=${encodeURIComponent(orgId)}`, {
      cache: "no-store",
      signal: AbortSignal.timeout(FEATURE_API_TIMEOUT_MS),
    });
    const data = (await response.json()) as VideoAnalysisSnapshot & { error?: string };
    if (!response.ok) {
      setFetchFailed(true);
      setErrorStatus(response.status);
      throw new Error(data.error ?? "Could not load videos.");
    }
    return { jobs: data.jobs ?? [] };
  }, [orgId]);

  const snapshot = useOfflineSnapshot<VideoAnalysisSnapshot>("video-analysis", orgId, fetchJobs);
  const jobs = snapshot.data?.jobs ?? [];
  const shell = classifyVideoAnalysisShell({
    loading: snapshot.loading && jobs.length === 0,
    fetchFailed: fetchFailed && jobs.length === 0,
    orgId,
    jobCount: jobs.length,
  });
  const shellCopy = videoAnalysisShellCopy(shell);
  const nextActions = videoAnalysisNextActions({
    orgId,
    shell,
    jobCount: jobs.length,
    pendingConfirmCount: pendingVideoConfirmCount(jobs),
  });

  async function queue(event: FormEvent) {
    event.preventDefault();
    if (!orgId || busy) return;
    setBusy(true);
    try {
      const response = await fetch("/api/video-analysis", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ orgId, sourceKind, sourceRef }),
        signal: AbortSignal.timeout(FEATURE_API_TIMEOUT_MS),
      });
      const data = (await response.json()) as { error?: string };
      if (!response.ok) {
        setMessage(data.error ?? "Could not start that video.");
        return;
      }
      setSourceRef("");
      setMessage("");
      await snapshot.refresh();
    } catch {
      setMessage("Could not start that video.");
    } finally {
      setBusy(false);
    }
  }

  async function confirm(id: string) {
    if (!orgId || busy) return;
    setBusy(true);
    try {
      const response = await fetch("/api/video-analysis", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ orgId, id, action: "confirm" }),
        signal: AbortSignal.timeout(FEATURE_API_TIMEOUT_MS),
      });
      const data = (await response.json()) as { error?: string };
      if (!response.ok) {
        setMessage(data.error ?? "Could not confirm that timeline.");
        return;
      }
      setMessage("Saved as video evidence. Scouted numbers were not changed.");
      await snapshot.refresh();
    } catch {
      setMessage("Could not confirm that timeline.");
    } finally {
      setBusy(false);
    }
  }

  if (shell === "loading" || shell === "error" || shell === "setup") {
    return (
      <VideoAnalysisShell
        orgId={orgId}
        shell={shell}
        error={shell === "error" ? shellCopy.description : undefined}
        errorStatus={errorStatus}
        onRetry={() => void snapshot.refresh()}
      >
        <OfflineBanner feature="Video" fromCache={Boolean(snapshot.cachedAt)} cachedAt={snapshot.cachedAt} />
      </VideoAnalysisShell>
    );
  }

  return (
    <div className="app-page video-analysis-page">
      <PageHeader
        breadcrumbs="Competition / Video"
        title="Video"
        description={VIDEO_PAGE_DESCRIPTION}
      >
        <VideoRelatedStrip orgId={orgId} />
      </PageHeader>
      {snapshot.offline ? (
        <OfflineBanner feature="Video" fromCache={Boolean(snapshot.cachedAt)} cachedAt={snapshot.cachedAt} />
      ) : null}
      {shell === "ready" ? <VideoNextActionsPanel actions={nextActions} /> : null}
      <VideoPasteForm
        sourceKind={sourceKind}
        sourceRef={sourceRef}
        busy={busy}
        message={message}
        onSourceKind={setSourceKind}
        onSourceRef={setSourceRef}
        onQueue={(event) => void queue(event)}
      />
      {shell === "empty" ? (
        <EmptyState
          soft
          badge={shellCopy.badge}
          badgeTone="setup"
          title={shellCopy.title}
          description={shellCopy.description}
        />
      ) : (
        <VideoQueueList jobs={jobs} busy={busy} onConfirm={(id) => void confirm(id)} />
      )}
    </div>
  );
}
