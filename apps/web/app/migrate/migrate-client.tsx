"use client";

import { useCallback, useEffect, useState } from "react";
import { EmptyState, FormGrid, FormRow, PageHeader, Panel } from "../../components/ui";
import type { MigrateView } from "../../lib/migrate/compute-migrate";
import { withOrgHref } from "../../lib/nav/product-nav";

type ConnectorId = "ics" | "scout" | "hours" | "notion";

type MigrateResponse = MigrateView & {
  error?: string;
  drafts?: unknown[];
  headers?: string[];
  written?: number;
  counts?: { calendar?: number; knowledge?: number; tasks?: number };
};

const CONNECTORS: Array<{
  id: ConnectorId;
  title: string;
  from: string;
  into: string;
}> = [
  { id: "ics", title: "Calendar (ICS)", from: "Google Calendar, Outlook, Apple", into: "Team calendar" },
  { id: "scout", title: "Scouting CSV", from: "Lovat, Sheets, ScoutingPASS", into: "Match scouting" },
  { id: "hours", title: "Hours CSV", from: "Lookout, GrizzlyTime", into: "Attendance + shop hours" },
  { id: "notion", title: "Notion JSON", from: "Exported database pages", into: "Calendar, knowledge, tasks" },
];

export default function MigrateClient() {
  const [view, setView] = useState<MigrateView | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [connector, setConnector] = useState<ConnectorId | null>(null);
  const [icsUrl, setIcsUrl] = useState("");
  const [icsPaste, setIcsPaste] = useState("");
  const [csvPaste, setCsvPaste] = useState("");
  const [hoursPaste, setHoursPaste] = useState("");
  const [notionPaste, setNotionPaste] = useState("");
  const [preview, setPreview] = useState("");

  const load = useCallback(() => {
    const orgId = new URLSearchParams(window.location.search).get("orgId");
    const query = orgId ? `?orgId=${encodeURIComponent(orgId)}` : "";
    void fetch(`/api/migrate${query}`)
      .then(async (response) => {
        const data = (await response.json()) as MigrateView | { error?: string };
        if (!response.ok || !("status" in data)) {
          setError("Could not load the switching kit.");
          return;
        }
        setView(data);
      })
      .catch(() => setError("Network error — please try again."));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const orgId = view && "orgId" in view ? view.orgId : null;
  const selected = CONNECTORS.find((item) => item.id === connector);

  async function post(payload: Record<string, unknown>) {
    if (!orgId) return;
    setError("");
    setBusy(true);
    try {
      const response = await fetch("/api/migrate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ orgId, ...payload }),
      });
      const data = (await response.json()) as MigrateResponse;
      if (!response.ok) {
        setError(data.error ? data.error : "Import failed.");
        return;
      }
      if ("status" in data) setView(data);
      if (Array.isArray(data.drafts)) setPreview(`${data.drafts.length} rows ready to import`);
      if (Array.isArray(data.headers)) setPreview(`CSV columns: ${data.headers.join(", ")}`);
      if (typeof data.written === "number") setPreview(`${data.written} rows written`);
      if (data.counts) {
        setPreview(
          `Calendar ${data.counts.calendar ?? 0} · Knowledge ${data.counts.knowledge ?? 0} · Tasks ${data.counts.tasks ?? 0}`,
        );
      }
    } finally {
      setBusy(false);
    }
  }

  function pickConnector(id: ConnectorId) {
    setConnector(id);
    setError("");
    setPreview("");
  }

  return (
    <main className="module-page migrate-page">
      <PageHeader
        breadcrumbs={
          <>
            <a href={orgId ? `/team?orgId=${encodeURIComponent(orgId)}` : "/team"}>Team</a>
            {" / Bring your season"}
          </>
        }
        title="Bring your season"
        description="Pick one source, preview real rows, then import. Dual-run until you turn the old tool off — never invent events."
      />
      {error ? <p className="app-muted migrate-error">{error}</p> : null}
      {view?.status === "setup_required" ? (
        <EmptyState title="Workspace required" description={view.message} />
      ) : null}
      {view?.status === "live" ? (
        <>
          <ol className="migrate-steps" aria-label="Import steps">
            <li className={connector ? "done" : "current"}>
              <b>1</b>
              Choose source
            </li>
            <li className={connector ? "current" : "upcoming"}>
              <b>2</b>
              Preview, then import
            </li>
          </ol>

          {!connector ? (
            <section className="migrate-picker" aria-label="Connectors">
              {CONNECTORS.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  className="migrate-tile"
                  onClick={() => pickConnector(item.id)}
                >
                  <strong>{item.title}</strong>
                  <span>From {item.from}</span>
                  <small>Into {item.into}</small>
                </button>
              ))}
            </section>
          ) : (
            <Panel>
              <header className="migrate-panel-head">
                <div>
                  <h2>{selected?.title}</h2>
                  <p className="app-muted">
                    From {selected?.from}. Preview first when the source can be guessed, then import.
                  </p>
                </div>
                <button type="button" className="app-button secondary" onClick={() => setConnector(null)}>
                  Change source
                </button>
              </header>

              {connector === "ics" ? (
                <>
                  <FormGrid>
                    <FormRow label="ICS URL">
                      <input
                        value={icsUrl}
                        onChange={(event) => setIcsUrl(event.target.value)}
                        placeholder="https://…"
                      />
                    </FormRow>
                  </FormGrid>
                  <div className="migrate-actions">
                    <button
                      type="button"
                      className="app-button"
                      disabled={busy || !icsUrl.trim()}
                      onClick={() => void post({ action: "connect-ics", icsUrl })}
                    >
                      Save feed
                    </button>
                    <button
                      type="button"
                      className="app-button secondary"
                      disabled={busy || !icsUrl.trim()}
                      onClick={() => void post({ action: "sync-ics", icsUrl })}
                    >
                      Pull now
                    </button>
                  </div>
                  <FormRow label="Or paste .ics">
                    <textarea value={icsPaste} onChange={(event) => setIcsPaste(event.target.value)} rows={8} />
                  </FormRow>
                  <div className="migrate-actions">
                    <button
                      type="button"
                      className="app-button"
                      disabled={busy || !icsPaste.trim()}
                      onClick={() => void post({ action: "commit-ics", content: icsPaste })}
                    >
                      Import into calendar
                    </button>
                    <button
                      type="button"
                      className="app-button secondary"
                      disabled={busy || !icsPaste.trim()}
                      onClick={() => void post({ action: "preview-ics", content: icsPaste })}
                    >
                      Preview
                    </button>
                  </div>
                  {view.inboundFeeds.length ? (
                    <ul className="migrate-feeds">
                      {view.inboundFeeds.map((feed) => (
                        <li key={feed.id}>{feed.icsUrl}</li>
                      ))}
                    </ul>
                  ) : null}
                  <p>
                    <a href={withOrgHref("/team/calendar", view.orgId)}>Open Calendar</a>
                  </p>
                </>
              ) : null}

              {connector === "scout" ? (
                <>
                  <FormRow label="Paste CSV header + rows">
                    <textarea value={csvPaste} onChange={(event) => setCsvPaste(event.target.value)} rows={8} />
                  </FormRow>
                  <p className="app-muted">
                    Rows need event key + team number. Free-text scout names are stripped. Missing TBA event years are
                    skipped.
                  </p>
                  <div className="migrate-actions">
                    <button
                      type="button"
                      className="app-button"
                      disabled={busy || !csvPaste.trim()}
                      onClick={() => void post({ action: "commit-scout-csv", content: csvPaste })}
                    >
                      Import scouting rows
                    </button>
                    <button
                      type="button"
                      className="app-button secondary"
                      disabled={busy || !csvPaste.trim()}
                      onClick={() => void post({ action: "preview-csv", content: csvPaste })}
                    >
                      Guess columns
                    </button>
                  </div>
                </>
              ) : null}

              {connector === "hours" ? (
                <>
                  <FormRow label="Paste person, hours, and date columns">
                    <textarea value={hoursPaste} onChange={(event) => setHoursPaste(event.target.value)} rows={8} />
                  </FormRow>
                  <div className="migrate-actions">
                    <button
                      type="button"
                      className="app-button"
                      disabled={busy || !hoursPaste.trim()}
                      onClick={() => void post({ action: "commit-hours-csv", content: hoursPaste })}
                    >
                      Import attendance hours
                    </button>
                  </div>
                  <p>
                    <a href={withOrgHref("/attendance", view.orgId)}>Open Attendance</a>
                    {" · "}
                    <a href={withOrgHref("/hours", view.orgId)}>Open shop hours</a>
                  </p>
                </>
              ) : null}

              {connector === "notion" ? (
                <>
                  {view.notionReady ? (
                    <p>Notion OAuth is configured. You can still paste database JSON below to dual-run.</p>
                  ) : (
                    <EmptyState
                      title="Notion OAuth is not configured"
                      description="Set NOTION_CLIENT_ID to enable OAuth. Paste exported database JSON to preview and commit pages without inventing titles."
                    />
                  )}
                  <FormRow label="Paste Notion database JSON">
                    <textarea value={notionPaste} onChange={(event) => setNotionPaste(event.target.value)} rows={8} />
                  </FormRow>
                  <div className="migrate-actions">
                    <button
                      type="button"
                      className="app-button"
                      disabled={busy || !notionPaste.trim()}
                      onClick={() => void post({ action: "commit-notion", content: notionPaste })}
                    >
                      Import calendar / knowledge / tasks
                    </button>
                    <button
                      type="button"
                      className="app-button secondary"
                      disabled={busy || !notionPaste.trim()}
                      onClick={() => void post({ action: "preview-notion", content: notionPaste })}
                    >
                      Preview
                    </button>
                  </div>
                  <p>
                    <a href={withOrgHref("/team/knowledge", view.orgId)}>Open Knowledge</a>
                    {" · "}
                    <a href={withOrgHref("/tasks", view.orgId)}>Open Tasks</a>
                  </p>
                </>
              ) : null}

              {preview ? <p className="migrate-preview">{preview}</p> : null}
            </Panel>
          )}
        </>
      ) : null}
    </main>
  );
}
