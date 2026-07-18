"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { EmptyState, FormGrid, FormRow, PageHeader, Panel } from "../../components/ui";
import { matchVideoSourceLabel } from "../../lib/match-video-index";
import {
  MATCH_VIDEO_SOURCES,
  type MatchVideoIndexView,
} from "../../lib/match-video-index/compute-match-video-index";
import type { MatchVideoSource } from "../../lib/match-video-index/types";

type LiveView = Extract<MatchVideoIndexView, { status: "live" }>;

export default function MatchVideoIndexClient() {
  const [view, setView] = useState<MatchVideoIndexView | null>(null);
  const [error, setError] = useState("");
  const [fetchFailed, setFetchFailed] = useState(false);
  const [busy, setBusy] = useState(false);

  const orgId = view && "orgId" in view ? view.orgId : null;

  const load = useCallback(() => {
    setFetchFailed(false);
    setError("");
    const params = new URLSearchParams(window.location.search);
    const urlOrg = params.get("orgId");
    const query = new URLSearchParams();
    if (urlOrg) query.set("orgId", urlOrg);
    void fetch(`/api/match-video-index${query.toString() ? `?${query.toString()}` : ""}`)
      .then(async (response) => {
        const data = (await response.json()) as MatchVideoIndexView | { error?: string };
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

  const mutate = useCallback(
    async (payload: Record<string, unknown>) => {
      if (!orgId || busy) return;
      setBusy(true);
      setError("");
      try {
        const response = await fetch("/api/match-video-index", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ orgId, ...payload }),
        });
        const data = (await response.json()) as MatchVideoIndexView | { error?: string };
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

  return (
    <main className="module-page">
      <PageHeader
        breadcrumbs={
          <>
            <a href={orgId ? `/competition?orgId=${encodeURIComponent(orgId)}` : "/competition"}>Competition</a>
            {" / Match Video Index"}
          </>
        }
        title="Match Video Index"
        description="Auto-index your match videos by match key for quick review — jump straight to the right clip."
      />

      {error ? (
        <p className="telemetry-status" role="alert">
          {error}
        </p>
      ) : null}

      {fetchFailed ? (
        <EmptyState
          title="Could not load Match Video Index"
          description="A network or server issue prevented loading. Try again."
        >
          <button type="button" className="app-button secondary" onClick={() => load()}>
            Retry
          </button>
        </EmptyState>
      ) : view == null ? (
        <EmptyState title="Loading…" description="Checking your workspace." aria-busy />
      ) : view.status === "setup_required" ? (
        <EmptyState badge="Setup required" badgeTone="setup" title={view.message}>
          <ol className="strategy-setup-steps">
            {view.steps.map((step) => (
              <li key={step.id}>
                <div>
                  <strong>{step.label}</strong>
                  <span>{step.detail}</span>
                </div>
                <a href={step.href}>Open</a>
              </li>
            ))}
          </ol>
        </EmptyState>
      ) : (
        <div style={{ display: "grid", gap: 16 }}>
          <SummaryTiles view={view} />
          <AddVideoForm busy={busy} mutate={mutate} />
          <VideoGroups view={view} busy={busy} mutate={mutate} />
        </div>
      )}
    </main>
  );
}

function SummaryTiles({ view }: { view: LiveView }) {
  const { summary } = view;
  const tiles = [
    { label: "Videos indexed", value: String(summary.totalVideos) },
    { label: "Matches covered", value: String(summary.totalMatches) },
    {
      label: "Top source",
      value: summary.bySource[0] ? matchVideoSourceLabel(summary.bySource[0].source) : "—",
    },
  ];
  return (
    <Panel>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 12 }}>
        {tiles.map((tile) => (
          <div key={tile.label}>
            <strong style={{ fontSize: "1.6rem", display: "block" }}>{tile.value}</strong>
            <span className="app-muted">{tile.label}</span>
          </div>
        ))}
      </div>
    </Panel>
  );
}

function VideoGroups({
  view,
  busy,
  mutate,
}: {
  view: LiveView;
  busy: boolean;
  mutate: (payload: Record<string, unknown>) => void;
}) {
  if (view.summary.totalVideos === 0) {
    return (
      <EmptyState
        badge="No videos yet"
        badgeTone="setup"
        title="Index your first match video"
        description="Add a video link with its match key to build a quick-review library for the whole team."
      />
    );
  }
  return (
    <Panel>
      <h2 style={{ marginTop: 0 }}>Videos by match</h2>
      <div style={{ display: "grid", gap: 14 }}>
        {view.groups.map((group) => (
          <div key={group.matchKey}>
            <strong>{group.matchLabel ?? group.matchKey}</strong>
            <small className="app-muted" style={{ display: "block", marginBottom: 6 }}>
              {group.matchKey}
              {group.eventKey ? ` · ${group.eventKey}` : ""}
            </small>
            <ul style={{ listStyle: "none", padding: 0, display: "grid", gap: 8 }}>
              {group.videos.map((video) => (
                <li
                  key={video.id}
                  style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "flex-start" }}
                >
                  <div>
                    <a href={video.videoUrl} target="_blank" rel="noreferrer" style={{ wordBreak: "break-all" }}>
                      {video.videoUrl}
                    </a>
                    <small className="app-muted" style={{ display: "block" }}>
                      {matchVideoSourceLabel(video.source)}
                      {video.recordedOn ? ` · ${video.recordedOn}` : ""}
                      {video.tags.length ? ` · ${video.tags.join(", ")}` : ""}
                    </small>
                    {video.notes ? <small className="app-muted">{video.notes}</small> : null}
                  </div>
                  <button
                    type="button"
                    className="text-button"
                    disabled={busy}
                    onClick={() => {
                      if (window.confirm("Remove this video from the index?")) {
                        mutate({ action: "delete-video", entryId: video.id });
                      }
                    }}
                  >
                    Delete
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </Panel>
  );
}

function AddVideoForm({
  busy,
  mutate,
}: {
  busy: boolean;
  mutate: (payload: Record<string, unknown>) => void;
}) {
  const empty = useMemo(
    () => ({
      matchKey: "",
      eventKey: "",
      matchLabel: "",
      videoUrl: "",
      source: "youtube" as MatchVideoSource,
      recordedOn: "",
      notes: "",
      tags: "",
    }),
    [],
  );
  const [form, setForm] = useState(empty);
  const set = (key: keyof typeof form) => (event: { target: { value: string } }) =>
    setForm((prev) => ({ ...prev, [key]: event.target.value }));

  return (
    <Panel
      as="form"
      onSubmit={(event) => {
        event.preventDefault();
        if (!form.matchKey.trim() || !form.videoUrl.trim()) return;
        mutate({
          action: "add-video",
          matchKey: form.matchKey,
          eventKey: form.eventKey || undefined,
          matchLabel: form.matchLabel || undefined,
          videoUrl: form.videoUrl,
          source: form.source,
          recordedOn: form.recordedOn || undefined,
          notes: form.notes || undefined,
          tags: form.tags
            ? form.tags.split(",").map((t) => t.trim()).filter(Boolean)
            : [],
        });
        setForm(empty);
      }}
      style={{ display: "grid", gap: 10 }}
    >
      <h2 style={{ margin: 0 }}>Add video</h2>
      <FormGrid min={160}>
        <FormRow label="Match key">
          <input value={form.matchKey} onChange={set("matchKey")} placeholder="2026casj_qm12" required />
        </FormRow>
        <FormRow label="Match label (optional)">
          <input value={form.matchLabel} onChange={set("matchLabel")} placeholder="Qual 12" />
        </FormRow>
        <FormRow label="Event key (optional)">
          <input value={form.eventKey} onChange={set("eventKey")} placeholder="2026casj" />
        </FormRow>
        <FormRow label="Video URL">
          <input value={form.videoUrl} onChange={set("videoUrl")} placeholder="https://youtu.be/..." required />
        </FormRow>
        <FormRow label="Source">
          <select value={form.source} onChange={set("source")}>
            {MATCH_VIDEO_SOURCES.map((source) => (
              <option key={source} value={source}>
                {matchVideoSourceLabel(source)}
              </option>
            ))}
          </select>
        </FormRow>
        <FormRow label="Recorded on (optional)">
          <input type="date" value={form.recordedOn} onChange={set("recordedOn")} />
        </FormRow>
        <FormRow label="Tags (comma separated, optional)">
          <input value={form.tags} onChange={set("tags")} placeholder="defense, endgame" />
        </FormRow>
      </FormGrid>
      <FormRow label="Notes (optional)">
        <textarea value={form.notes} onChange={set("notes")} rows={2} />
      </FormRow>
      <div>
        <button type="submit" className="app-button" disabled={busy || !form.matchKey.trim() || !form.videoUrl.trim()}>
          Add video
        </button>
      </div>
    </Panel>
  );
}
