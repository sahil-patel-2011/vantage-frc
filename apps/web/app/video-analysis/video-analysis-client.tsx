"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { EmptyState, PageHeader, Panel } from "../../components/ui";
import { OfflineBanner } from "../../components/offline-banner";
import { Button } from "../../components/ui/button";
import { useOfflineSnapshot } from "../../lib/offline/use-offline-snapshot";

type VideoEvent = {
  tSec?: number;
  kind?: string;
  teamKey?: string;
  label?: string;
  confidence?: number;
};

type VideoResult = {
  summary?: string;
  events?: VideoEvent[];
  cyclesByTeam?: Array<{ teamKey: string; cycles: number; confidence: number }>;
};

type Job = {
  id: string;
  sourceKind: string;
  sourceRef: string;
  matchKey: string | null;
  status: string;
  minutesBehind: number | null;
  error: string | null;
  createdAt: string;
  result: VideoResult | null;
  confirmed: boolean;
};

type Snapshot = { jobs: Job[] };

export default function VideoAnalysisClient() {
  const [orgId, setOrgId] = useState("");
  const [sourceRef, setSourceRef] = useState("");
  const [sourceKind, setSourceKind] = useState("youtube");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setOrgId(new URLSearchParams(window.location.search).get("orgId") ?? "");
  }, []);

  const fetchJobs = useCallback(async (): Promise<Snapshot> => {
    const response = await fetch(`/api/video-analysis?orgId=${encodeURIComponent(orgId)}`);
    const data = (await response.json()) as { jobs?: Job[]; error?: string };
    if (!response.ok) throw new Error(data.error ?? "Could not load video jobs.");
    return { jobs: data.jobs ?? [] };
  }, [orgId]);

  const snapshot = useOfflineSnapshot<Snapshot>("video-analysis", orgId, fetchJobs);
  const jobs = snapshot.data?.jobs ?? [];

  async function queue(event: FormEvent) {
    event.preventDefault();
    if (!orgId || busy) return;
    setBusy(true);
    try {
      const response = await fetch("/api/video-analysis", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ orgId, sourceKind, sourceRef }),
      });
      const data = (await response.json()) as { error?: string };
      if (!response.ok) {
        setMessage(data.error ?? "Could not queue that video.");
        return;
      }
      setSourceRef("");
      setMessage("");
      await snapshot.refresh();
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
      });
      const data = (await response.json()) as { error?: string; mergedIntoScouting?: boolean };
      if (!response.ok) {
        setMessage(data.error ?? "Could not confirm that timeline.");
        return;
      }
      setMessage("Saved as video evidence. Scouted numbers were not changed.");
      await snapshot.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="app-page">
      <PageHeader
        title="Analyze video"
        description="Paste a match or pit video. The video Pi writes a timeline with timestamps. Confirm keeps it as video evidence — it does not overwrite what a scout typed."
      />
      {snapshot.offline ? (
        <OfflineBanner feature="Analyze video" fromCache={Boolean(snapshot.cachedAt)} cachedAt={snapshot.cachedAt} />
      ) : null}
      {!orgId ? (
        <EmptyState
          title="Pick a team first"
          description="Open this page from Competition so Vantage knows which team the video belongs to."
        />
      ) : (
        <>
          <Panel>
            <form onSubmit={(event) => void queue(event)}>
              <label>
                Where is the video?
                <select value={sourceKind} onChange={(event) => setSourceKind(event.target.value)}>
                  <option value="youtube">YouTube</option>
                  <option value="tba">The Blue Alliance</option>
                  <option value="upload">Uploaded file</option>
                  <option value="pit_stream">Pit camera</option>
                </select>
              </label>
              <label>
                Link or file id
                <input
                  value={sourceRef}
                  onChange={(event) => setSourceRef(event.target.value)}
                  placeholder="https://www.youtube.com/watch?v=…"
                  required
                />
              </label>
              <Button type="submit" variant="primary" disabled={busy}>
                {busy ? "Queuing…" : "Queue analysis"}
              </Button>
            </form>
            {message ? <p className="app-muted">{message}</p> : null}
          </Panel>
          {snapshot.loading && jobs.length === 0 ? (
            <p className="app-muted">Loading video jobs…</p>
          ) : jobs.length === 0 ? (
            <EmptyState
              title="No video jobs yet"
              description="Queue a match video. Analysis stays off until a Pi with the video role is paired and online."
            >
              <Button as="a" href="/team/relays" variant="secondary">
                Pair a video Pi
              </Button>
            </EmptyState>
          ) : (
            <ul>
              {jobs.map((job) => (
                <li key={job.id}>
                  <strong>{job.sourceKind}</strong> · {job.status}
                  {job.minutesBehind != null ? ` · ${job.minutesBehind} min behind` : ""}
                  {job.confirmed ? " · confirmed as video evidence" : ""}
                  <div>{job.sourceRef}</div>
                  {job.error ? <div>{job.error}</div> : null}
                  {job.result?.summary ? <p>{job.result.summary}</p> : null}
                  {job.result?.events?.length ? (
                    <ol>
                      {job.result.events.slice(0, 24).map((event, index) => (
                        <li key={`${job.id}-${index}`}>
                          {event.tSec != null ? `${event.tSec}s · ` : ""}
                          {event.label ?? event.kind}
                          {typeof event.confidence === "number"
                            ? ` · from video (confidence ${event.confidence.toFixed(1)})`
                            : ""}
                        </li>
                      ))}
                    </ol>
                  ) : null}
                  {job.status === "completed" && !job.confirmed ? (
                    <Button type="button" variant="secondary" disabled={busy} onClick={() => void confirm(job.id)}>
                      Confirm — keep as video evidence
                    </Button>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}
