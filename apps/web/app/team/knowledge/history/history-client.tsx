"use client";

import { useEffect, useState } from "react";

type Revision = {
  id: string;
  content: string;
  createdAt: string;
  editorEmail: string | null;
};

export default function KnowledgeHistoryClient({ orgId }: { orgId: string }) {
  const [revisions, setRevisions] = useState<Revision[]>([]);
  const [openId, setOpenId] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    async function load() {
      setLoading(true);
      const response = await fetch(`/api/team/knowledge-history?orgId=${orgId}`);
      const data = await response.json();
      if (!active) return;
      if (!response.ok) setMessage(data.error ?? "Unable to load history");
      else {
        setMessage("");
        setRevisions(data.revisions ?? []);
      }
      setLoading(false);
    }
    void load();
    return () => {
      active = false;
    };
  }, [orgId]);

  async function copy(content: string) {
    try {
      await navigator.clipboard.writeText(content);
      setMessage("Copied that version — paste it into the editor to restore.");
    } catch {
      setMessage("Copy failed — open the version and select the text.");
    }
  }

  return (
    <main className="intel-app">
      <header className="intel-header">
        <div>
          <span className="eyebrow">VANTAGE / KNOWLEDGE HISTORY</span>
          <h1>Team Knowledge — version history</h1>
          <p className="app-muted">
            Every save is snapshotted here. Copy an older version and paste it back into the editor to roll back.
          </p>
        </div>
        <nav className="intel-actions" aria-label="Knowledge links">
          <a href={`/team/knowledge?orgId=${orgId}`}>← Back to editor</a>
        </nav>
      </header>

      {message && <p role="status" className="telemetry-status">{message}</p>}
      {loading && <p className="app-muted">Loading history…</p>}

      {!loading && (
        <section className="intel-panel">
          <span className="eyebrow">REVISIONS · {revisions.length}</span>
          {!revisions.length && <p className="app-muted">No saved revisions yet.</p>}
          {revisions.map((rev, index) => (
            <article className="admin-org" style={{ display: "block", padding: "12px 0" }} key={rev.id}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: "12px" }}>
                <strong>
                  {index === 0 ? "Current" : `Version ${revisions.length - index}`} ·{" "}
                  {new Date(rev.createdAt).toLocaleString()}
                </strong>
                <div className="intel-actions">
                  <button type="button" onClick={() => setOpenId(openId === rev.id ? null : rev.id)}>
                    {openId === rev.id ? "Hide" : "View"}
                  </button>
                  <button type="button" onClick={() => void copy(rev.content)}>
                    Copy
                  </button>
                </div>
              </div>
              <small>{rev.editorEmail ?? "An admin"} · {rev.content.length.toLocaleString()} chars</small>
              {openId === rev.id && (
                <pre
                  style={{
                    marginTop: "8px",
                    maxHeight: "320px",
                    overflow: "auto",
                    padding: "12px",
                    whiteSpace: "pre-wrap",
                    background: "#091014",
                    color: "#cbd5d9",
                    border: "1px solid #253139",
                    font: "12px/1.5 ui-monospace, monospace",
                  }}
                >
                  {rev.content}
                </pre>
              )}
            </article>
          ))}
        </section>
      )}
    </main>
  );
}
