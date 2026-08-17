"use client";

import { useEffect, useMemo, useState } from "react";

type Domain = {
  id: string;
  description: string;
  scope: "team" | "private";
  fileName: string;
  category: string;
  provenance: string;
};

type Job = {
  id: string;
  scope: string;
  status: string;
  domains: string[];
  progress: number;
  sizeBytes: number | null;
  expiresAt: string | null;
  createdAt: string;
  error: string | null;
};

const CATEGORY_ORDER = ["scouting", "reference", "strategy", "ai", "ops"] as const;
const CATEGORY_LABELS: Record<string, string> = {
  scouting: "Scouting",
  reference: "Official reference (TBA)",
  strategy: "Strategy & research",
  ai: "AI artifacts",
  ops: "Ops & billing",
};

const EXCLUSIONS = [
  "API keys and OAuth / session tokens",
  "Passwords, OTP / MFA secrets or hashes",
  "Encryption material and payment credentials",
  "Display tokens and internal security fields",
  "Invite tokens",
  "Other teams' workspaces (org_id isolation)",
];

function preselectedFromUrl(): string[] {
  if (typeof window === "undefined") return [];
  const raw = new URLSearchParams(window.location.search).get("domains");
  return raw ? raw.split(",").map((item) => item.trim()).filter(Boolean) : [];
}

function scopeFromUrl(): "team" | "private" {
  if (typeof window === "undefined") return "team";
  return new URLSearchParams(window.location.search).get("scope") === "private" ? "private" : "team";
}

function eventFromUrl(): string {
  if (typeof window === "undefined") return "";
  return new URLSearchParams(window.location.search).get("eventKey") ?? "";
}

async function downloadBlob(response: Response, fallbackName: string) {
  const blob = await response.blob();
  const header = response.headers.get("content-disposition") ?? "";
  const match = /filename="([^"]+)"/.exec(header);
  const name = match?.[1] ?? fallbackName;
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = name;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

export default function ExportCenter({ orgId }: { orgId: string }) {
  const [domains, setDomains] = useState<Domain[]>([]);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [scope, setScope] = useState<"team" | "private">("team");
  const [eventKey, setEventKey] = useState("");
  const [excelBom, setExcelBom] = useState(true);
  const [message, setMessage] = useState("");
  const [ok, setOk] = useState(false);
  const [busy, setBusy] = useState(false);

  async function load() {
    const response = await fetch(`/api/exports?orgId=${encodeURIComponent(orgId)}`);
    const data = await response.json();
    if (response.ok) {
      setDomains(data.domains);
      setJobs(data.jobs);
    } else {
      setOk(false);
      setMessage(data.error ?? "Unable to load exports");
    }
  }

  useEffect(() => {
    setScope(scopeFromUrl());
    setEventKey(eventFromUrl());
    setSelected(preselectedFromUrl());
    void load();
    const timer = setInterval(() => void load(), 3000);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- poll by org only
  }, [orgId]);

  const available = useMemo(() => domains.filter((domain) => domain.scope === scope), [domains, scope]);

  const grouped = useMemo(() => {
    return CATEGORY_ORDER.map((category) => ({
      category,
      label: CATEGORY_LABELS[category] ?? category,
      items: available.filter((item) => item.category === category),
    })).filter((group) => group.items.length > 0);
  }, [available]);

  async function createZip(all = false) {
    setBusy(true);
    const response = await fetch("/api/exports", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        orgId,
        scope,
        domains: all ? "all" : selected,
        filters: { eventKey: eventKey || undefined, excelBom },
      }),
    });
    const data = await response.json();
    setOk(response.ok);
    setMessage(
      response.ok
        ? "ZIP export queued. You can leave this page — we’ll notify you when it’s ready (24h download window)."
        : (data.error ?? "Export failed"),
    );
    if (response.ok) {
      setSelected([]);
      await load();
    }
    setBusy(false);
  }

  async function downloadCsv() {
    if (selected.length !== 1) {
      setOk(false);
      setMessage("Select exactly one domain for instant CSV download.");
      return;
    }
    setBusy(true);
    const response = await fetch("/api/exports", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        action: "csv",
        orgId,
        scope,
        domain: selected[0],
        domains: selected,
        filters: { eventKey: eventKey || undefined, excelBom },
      }),
    });
    if (!response.ok) {
      const data = await response.json();
      setOk(false);
      setMessage(data.error ?? "CSV export failed");
      setBusy(false);
      return;
    }
    await downloadBlob(response, `${selected[0]}.csv`);
    setOk(true);
    setMessage(`CSV downloaded · ${response.headers.get("x-vantage-provenance") ?? "audited"}`);
    setBusy(false);
  }

  async function downloadPdf() {
    setBusy(true);
    const response = await fetch("/api/exports", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        action: "pdf",
        orgId,
        scope,
        domains: [],
        filters: { eventKey: eventKey || undefined },
      }),
    });
    if (!response.ok) {
      const data = await response.json();
      setOk(false);
      setMessage(data.error ?? "PDF export failed");
      setBusy(false);
      return;
    }
    await downloadBlob(response, "vantage-export-inventory.pdf");
    setOk(true);
    setMessage("Provenance inventory PDF downloaded.");
    setBusy(false);
  }

  async function downloadZip(jobId: string) {
    const response = await fetch("/api/exports", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "download", orgId, jobId, scope, domains: [] }),
    });
    const data = await response.json();
    if (response.ok) location.assign(data.url);
    else {
      setOk(false);
      setMessage(data.error ?? "Download failed");
    }
  }

  async function cancel(jobId: string) {
    await fetch("/api/exports", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ orgId, jobId }),
    });
    await load();
  }

  return (
    <main className="module-page export-page">
      <header className="app-page-header">
        <div>
          <span className="breadcrumbs">Team / Export Center</span>
          <h1>Exports</h1>
          <p>
            Download this team&apos;s data — including AI chats and memory — as audited CSV or ZIP. Each workspace is
            isolated; credentials and other teams&apos; rows are never included.
          </p>
        </div>
        <div className="export-header-actions">
          <button type="button" className="app-button secondary" disabled={busy} onClick={() => void downloadPdf()}>
            PDF inventory
          </button>
          <a className="app-button secondary" href={`/team/data?orgId=${encodeURIComponent(orgId)}`}>
            Data analytics
          </a>
        </div>
      </header>

      <nav className="export-cross-nav" aria-label="Related team data">
        <a href={`/scouting?orgId=${encodeURIComponent(orgId)}`}>Scouting</a>
        <a href={`/strategy?orgId=${encodeURIComponent(orgId)}`}>Strategy</a>
        <a href={`/business?orgId=${encodeURIComponent(orgId)}`}>Business</a>
        <a href={`/team/usage?orgId=${encodeURIComponent(orgId)}`}>AI usage</a>
        <a href={`/team/data?orgId=${encodeURIComponent(orgId)}`}>Live TBA data</a>
      </nav>

      {message ? (
        <p className={`telemetry-status${ok ? " success" : ""}`} role="status">
          {message}
        </p>
      ) : null}

      <div className="export-layout">
        <section className="app-card soft-panel export-panel">
          <h2>Choose data</h2>
          <div className="export-tabs" role="tablist" aria-label="Export scope">
            <button
              type="button"
              role="tab"
              aria-selected={scope === "team"}
              onClick={() => {
                setScope("team");
                setSelected([]);
              }}
            >
              Team-shared
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={scope === "private"}
              onClick={() => {
                setScope("private");
                setSelected([]);
              }}
            >
              My private AI data
            </button>
          </div>

          {scope === "private" ? (
            <p className="app-muted">
              Only your private conversations and memory appear here. Organization administrators cannot silently export
              them.
            </p>
          ) : null}

          <div className="export-filters">
            <label>
              Event filter (optional)
              <input
                type="text"
                value={eventKey}
                onChange={(event) => setEventKey(event.target.value)}
                placeholder="Example: 2026miket"
              />
            </label>
            <label className="export-check">
              <input type="checkbox" checked={excelBom} onChange={(event) => setExcelBom(event.target.checked)} />
              <span>
                <strong>Excel UTF-8 marker</strong>
                <small>Keep non-ASCII team data readable in Excel</small>
              </span>
            </label>
          </div>

          {grouped.map((group) => (
            <div className="export-category" key={group.category}>
              <span>{group.label}</span>
              {group.items.map((domain) => (
                <label className="export-domain" key={domain.id}>
                  <input
                    type="checkbox"
                    checked={selected.includes(domain.id)}
                    onChange={(event) =>
                      setSelected(
                        event.target.checked
                          ? [...selected, domain.id]
                          : selected.filter((id) => id !== domain.id),
                      )
                    }
                  />
                  <span>
                    <strong>{domain.fileName}</strong>
                    <small>{domain.description}</small>
                    <span className="prov">{domain.provenance}</span>
                  </span>
                  <button
                    type="button"
                    className="app-button secondary sm"
                    disabled={busy}
                    onClick={() => {
                      setSelected([domain.id]);
                      void (async () => {
                        setBusy(true);
                        const response = await fetch("/api/exports", {
                          method: "POST",
                          headers: { "content-type": "application/json" },
                          body: JSON.stringify({
                            action: "csv",
                            orgId,
                            scope,
                            domain: domain.id,
                            domains: [domain.id],
                            filters: { eventKey: eventKey || undefined, excelBom },
                          }),
                        });
                        if (!response.ok) {
                          const data = await response.json();
                          setOk(false);
                          setMessage(data.error ?? "CSV export failed");
                        } else {
                          await downloadBlob(response, domain.fileName);
                          setOk(true);
                          setMessage(`Downloaded ${domain.fileName}`);
                        }
                        setBusy(false);
                      })();
                    }}
                  >
                    CSV
                  </button>
                </label>
              ))}
            </div>
          ))}

          <div className="export-actions">
            <button
              type="button"
              className="app-button"
              disabled={busy || !selected.length}
              onClick={() => void createZip()}
            >
              ZIP selected
            </button>
            <button
              type="button"
              className="app-button secondary"
              disabled={busy || selected.length !== 1}
              onClick={() => void downloadCsv()}
            >
              Instant CSV
            </button>
            <button type="button" className="app-button secondary" disabled={busy} onClick={() => void createZip(true)}>
              ZIP all {scope === "team" ? "team" : "private"} data
            </button>
            <button
              type="button"
              className="app-button secondary"
              disabled={busy}
              onClick={() => {
                const ids = available
                  .filter((item) =>
                    scope === "private"
                      ? item.id === "ai-private-conversations" || item.id === "ai-private-memory"
                      : item.category === "ai" || item.id === "usage",
                  )
                  .map((item) => item.id);
                setSelected(ids);
                setMessage(
                  scope === "private"
                    ? "Selected your private AI chats and memory only."
                    : "Selected this team's AI chats, memory, and artifacts — not other workspaces.",
                );
                setOk(true);
              }}
            >
              {scope === "private" ? "Select my AI takeout" : "Select this team's AI takeout"}
            </button>
          </div>
        </section>

        <aside className="export-panel">
          <section className="app-card soft-panel export-panel">
            <h2>What is excluded</h2>
            <ul className="export-exclude">
              {EXCLUSIONS.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
            <p className="app-muted">
              CSV cells are RFC 4180 quoted, UTC timestamps are stable, and spreadsheet formulas are neutralized. ZIP
              archives include <code>manifest.json</code> + <code>PROVENANCE.txt</code> and expire after 24 hours.
            </p>
          </section>

          <section className="app-card soft-panel export-panel">
            <h2>Recent jobs</h2>
            {jobs.length === 0 ? (
              <div className="export-empty">
                <span className="app-badge setup">No exports yet</span>
                <p className="app-muted">Queue a ZIP above, or grab a single CSV instantly.</p>
              </div>
            ) : (
              jobs.map((job) => (
                <article className="export-job" key={job.id}>
                  <header>
                    <strong>
                      {job.scope} · {job.domains.length} files
                    </strong>
                    <small>{new Date(job.createdAt).toLocaleString()}</small>
                  </header>
                  <progress value={job.progress} max={100} aria-label={`${job.progress}% complete`} />
                  <div className="export-job-meta">
                    <span>
                      {job.status} · {job.progress}%
                      {job.sizeBytes ? ` · ${(job.sizeBytes / 1024).toFixed(1)} KB` : ""}
                    </span>
                    {job.status === "completed" ? (
                      <button type="button" className="app-button secondary sm" onClick={() => void downloadZip(job.id)}>
                        Download ZIP
                      </button>
                    ) : null}
                    {["queued", "running"].includes(job.status) ? (
                      <button type="button" className="app-button secondary sm" onClick={() => void cancel(job.id)}>
                        Cancel
                      </button>
                    ) : null}
                  </div>
                  {job.error ? <small className="app-muted">{job.error}</small> : null}
                  {job.expiresAt && job.status === "completed" ? (
                    <small className="app-muted">Expires {new Date(job.expiresAt).toLocaleString()}</small>
                  ) : null}
                </article>
              ))
            )}
          </section>
        </aside>
      </div>
    </main>
  );
}
