"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "../../components/ui";
import { activityRelativeTime } from "./cad-model";

type ActivityRow = {
  id: string;
  source: "terminal" | "web";
  title: string;
  platform: string;
  status: string;
  documentName: string | null;
  documentUrl: string | null;
  machineName: string | null;
  authorName: string | null;
  mine: boolean;
  toolCallCount: number;
  lastTool: string | null;
  updatedAt: string;
};

type ActivityDetailStep = {
  index: number;
  tool: string;
  title: string;
  detail: string;
  status: "done" | "failed";
  at: string;
};

type ActivityDetail = {
  id: string;
  source: "terminal" | "web";
  status: string;
  documentName: string | null;
  documentUrl: string | null;
  steps: ActivityDetailStep[];
  emptyReason: string | null;
};

const ACTIVITY_SOURCE_LABELS: Record<ActivityRow["source"], string> = {
  terminal: "This computer",
  web: "This page",
};

type ActivityScope = "all" | "mine";
type ActivitySource = "all" | "web" | "terminal";

const SCOPE_OPTIONS: Array<{ value: ActivityScope; label: string }> = [
  { value: "all", label: "Everyone" },
  { value: "mine", label: "Mine" },
];

const SOURCE_OPTIONS: Array<{ value: ActivitySource; label: string }> = [
  { value: "all", label: "All" },
  { value: "web", label: "This page" },
  { value: "terminal", label: "This computer" },
];

/** Sessions from this page and from Claude Code on this computer. */
export function CadActivityPanel({ orgId }: { orgId: string }) {
  const [rows, setRows] = useState<ActivityRow[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [scope, setScope] = useState<ActivityScope>("all");
  const [source, setSource] = useState<ActivitySource>("all");
  // One row expanded at a time; details are fetched on demand, not with the list.
  const [openId, setOpenId] = useState<string | null>(null);
  const [details, setDetails] = useState<Record<string, ActivityDetail | "loading" | "failed">>({});

  const loadActivity = useCallback(async () => {
    setRefreshing(true);
    try {
      const query = new URLSearchParams({ orgId, scope, source });
      const response = await fetch(`/api/cad/activity?${query.toString()}`);
      const data = (await response.json()) as { activity?: ActivityRow[]; error?: string };
      if (!response.ok) throw new Error(data.error ?? "Could not load CAD activity");
      setRows(data.activity ?? []);
      setFailed(false);
    } catch {
      setFailed(true);
    } finally {
      setRefreshing(false);
    }
  }, [orgId, scope, source]);

  useEffect(() => {
    void loadActivity();
  }, [loadActivity]);

  const toggleDetail = useCallback(
    async (id: string) => {
      if (openId === id) {
        setOpenId(null);
        return;
      }
      setOpenId(id);
      // Re-fetch a row that previously failed; keep a good result cached.
      if (details[id] && details[id] !== "failed") return;
      setDetails((prev) => ({ ...prev, [id]: "loading" }));
      try {
        const query = new URLSearchParams({ orgId, sessionId: id });
        const response = await fetch(`/api/cad/activity?${query.toString()}`);
        const data = (await response.json()) as { detail?: ActivityDetail; error?: string };
        if (!response.ok || !data.detail) throw new Error(data.error ?? "Could not load this session");
        setDetails((prev) => ({ ...prev, [id]: data.detail! }));
      } catch {
        setDetails((prev) => ({ ...prev, [id]: "failed" }));
      }
    },
    [details, openId, orgId],
  );

  const filtered = scope === "mine" || source !== "all";

  return (
    <section className="cad-activity" aria-label="Recent CAD activity">
      <div className="cad-activity-head">
        <span>Recent CAD activity</span>
        <div className="cad-activity-filters">
          <div className="cad-activity-filter" role="group" aria-label="Whose sessions">
            {SCOPE_OPTIONS.map((option) => (
              <button
                key={option.value}
                type="button"
                className={`cad-activity-chip${scope === option.value ? " active" : ""}`}
                aria-pressed={scope === option.value}
                onClick={() => setScope(option.value)}
              >
                {option.label}
              </button>
            ))}
          </div>
          <div className="cad-activity-filter" role="group" aria-label="Session source">
            {SOURCE_OPTIONS.map((option) => (
              <button
                key={option.value}
                type="button"
                className={`cad-activity-chip${source === option.value ? " active" : ""}`}
                aria-pressed={source === option.value}
                onClick={() => setSource(option.value)}
              >
                {option.label}
              </button>
            ))}
          </div>
          <Button variant="secondary" type="button" disabled={refreshing} onClick={() => void loadActivity()}>
            {refreshing ? "Refreshing…" : "Refresh"}
          </Button>
        </div>
      </div>
      {failed ? (
        <p className="cad-activity-error">Could not load CAD activity right now. Refresh to retry.</p>
      ) : rows === null ? (
        <p className="cad-activity-empty">Loading activity…</p>
      ) : rows.length === 0 ? (
        <p className="cad-activity-empty">
          {filtered ? (
            <>No CAD sessions match this filter. Switch to Everyone / All to see the rest.</>
          ) : (
            <>
              No CAD activity yet. Sessions from this page and from Claude Code on this computer will
              appear here once someone sketches or extrudes.
            </>
          )}
        </p>
      ) : (
        <ul className="cad-activity-list">
          {rows.map((row) => {
            const detail = details[row.id];
            const open = openId === row.id;
            return (
              <li key={row.id} className="cad-activity-item">
                <button
                  type="button"
                  className="cad-activity-row"
                  aria-expanded={open}
                  onClick={() => void toggleDetail(row.id)}
                >
                  <span className={`cad-activity-source cad-activity-source--${row.source}`}>
                    {ACTIVITY_SOURCE_LABELS[row.source]}
                  </span>
                  <span className="cad-activity-title">
                    {row.documentName ? `${row.title} — ${row.documentName}` : row.title}
                  </span>
                  <span className="cad-activity-meta">
                    {row.platform}
                    {row.mine ? " · you" : row.authorName ? ` · ${row.authorName}` : ""}
                    {row.source === "terminal" && row.machineName ? ` · ${row.machineName}` : ""}
                    {row.toolCallCount > 0
                      ? ` · ${row.toolCallCount} step${row.toolCallCount === 1 ? "" : "s"}${
                          row.lastTool ? ` (last: ${row.lastTool})` : ""
                        }`
                      : ""}
                    {row.updatedAt ? ` · ${activityRelativeTime(row.updatedAt)}` : ""}
                  </span>
                  {row.status === "failed" ? <span className="cad-activity-status--failed">Failed</span> : null}
                  <span aria-hidden="true" className="cad-activity-caret">
                    {open ? "▾" : "▸"}
                  </span>
                </button>
                {open ? (
                  <div className="cad-activity-detail">
                    {detail === "loading" || detail === undefined ? (
                      <p className="cad-activity-empty">Loading session…</p>
                    ) : detail === "failed" ? (
                      <p className="cad-activity-error">
                        Could not load this session. Collapse and reopen to retry.
                      </p>
                    ) : (
                      <>
                        {detail.documentUrl ? (
                          <a
                            className="cad-activity-open"
                            href={detail.documentUrl}
                            target="_blank"
                            rel="noreferrer"
                          >
                            Open in Onshape
                          </a>
                        ) : null}
                        {detail.steps.length ? (
                          <ol className="cad-step-list">
                            {detail.steps.map((step) => (
                              <li key={`${detail.id}-${step.index}`} className={`cad-step cad-step--${step.status}`}>
                                <span className="cad-step-index">{step.index}</span>
                                <span className="cad-step-body">
                                  <span className="cad-step-title">{step.title}</span>
                                  {step.detail ? <span className="cad-step-detail">{step.detail}</span> : null}
                                </span>
                                <span className="cad-step-status">
                                  {step.status === "failed" ? "Failed" : "Done"}
                                </span>
                              </li>
                            ))}
                          </ol>
                        ) : (
                          <p className="cad-activity-empty">{detail.emptyReason}</p>
                        )}
                      </>
                    )}
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
