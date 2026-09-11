"use client";

import { type FormEvent } from "react";
import { Panel, Button } from "../../components/ui";
import {
  VIDEO_SOURCE_KINDS,
  labelVideoSourceKind,
  labelVideoStatus,
  videoEventSureLabel,
  type VideoAnalysisJob,
  type VideoSourceKind,
} from "../../lib/video-analysis/video-analysis-related";

export function VideoPasteForm({
  sourceKind,
  sourceRef,
  busy,
  message,
  onSourceKind,
  onSourceRef,
  onQueue,
}: {
  sourceKind: string;
  sourceRef: string;
  busy: boolean;
  message: string;
  onSourceKind: (kind: VideoSourceKind) => void;
  onSourceRef: (value: string) => void;
  onQueue: (event: FormEvent) => void;
}) {
  return (
    <Panel id="video-paste" aria-label="Paste a video">
      <form onSubmit={onQueue}>
        <label>
          Where is the video?
          <select
            value={sourceKind}
            onChange={(event) => onSourceKind(event.target.value as VideoSourceKind)}
          >
            {VIDEO_SOURCE_KINDS.map((kind) => (
              <option key={kind} value={kind}>
                {labelVideoSourceKind(kind)}
              </option>
            ))}
          </select>
        </label>
        <label>
          Video link
          <input
            value={sourceRef}
            onChange={(event) => onSourceRef(event.target.value)}
            placeholder="https://www.youtube.com/watch?v=…"
            required
          />
        </label>
        <Button type="submit" variant="primary" disabled={busy}>
          {busy ? "Starting…" : "Analyze this video"}
        </Button>
      </form>
      {message ? <p className="app-muted">{message}</p> : null}
    </Panel>
  );
}

export function VideoQueueList({
  jobs,
  busy,
  onConfirm,
}: {
  jobs: VideoAnalysisJob[];
  busy: boolean;
  onConfirm: (id: string) => void;
}) {
  const pending = jobs.filter((job) => job.status === "completed" && !job.confirmed);
  return (
    <ul id="video-queue" style={{ listStyle: "none", padding: 0, margin: 0, display: "grid", gap: 12 }}>
      {jobs.map((job) => (
        <li key={job.id} id={pending[0]?.id === job.id ? "video-ready" : undefined}>
          <Panel aria-label={`${labelVideoSourceKind(job.sourceKind)} ${labelVideoStatus(job.status, job.confirmed)}`}>
            <strong>{labelVideoSourceKind(job.sourceKind)}</strong>
            {" · "}
            {labelVideoStatus(job.status, job.confirmed)}
            {job.minutesBehind != null ? ` · ${job.minutesBehind} min behind` : ""}
            <div>{job.sourceRef}</div>
            {job.error ? <div>{job.error}</div> : null}
            {job.result?.summary ? <p>{job.result.summary}</p> : null}
            {job.result?.events?.length ? (
              <ol>
                {job.result.events.slice(0, 24).map((event, index) => (
                  <li key={`${job.id}-${index}`}>
                    {event.tSec != null ? `${event.tSec}s · ` : ""}
                    {event.label ?? event.kind}
                    {` · ${videoEventSureLabel(event.confidence)}`}
                  </li>
                ))}
              </ol>
            ) : null}
            {job.status === "completed" && !job.confirmed ? (
              <Button type="button" variant="secondary" disabled={busy} onClick={() => onConfirm(job.id)}>
                Confirm — keep as video evidence
              </Button>
            ) : null}
          </Panel>
        </li>
      ))}
    </ul>
  );
}
