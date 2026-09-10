"use client";
import { Button } from "../../../../components/ui";

import { useEffect, useState } from "react";
import "../knowledge.css";

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
      setMessage("Copied that version — paste it into the AI context editor to restore.");
    } catch {
      setMessage("Copy failed — open the version and select the text.");
    }
  }

  return (
    <main className="module-page kb-page">
      <header className="kb-hero">
        <div>
          <span className="breadcrumbs">Team / Knowledge / History</span>
          <h1>AI context — version history</h1>
          <p>Every save of the AI context document is snapshotted here. Copy an older version to roll back.</p>
        </div>
        <div className="kb-hero-actions">
          <Button as="a" variant="secondary" href={`/team/knowledge?orgId=${orgId}`}>
            ← Back to knowledge
          </Button>
        </div>
      </header>

      {message ? (
        <p className="kb-status" role="status">
          {message}
        </p>
      ) : null}
      {loading ? <p className="app-muted">Loading history…</p> : null}

      {!loading ? (
        <section className="soft-card">
          <h2 style={{ margin: "0 0 12px", fontSize: 16 }}>Revisions · {revisions.length}</h2>
          {!revisions.length ? <p className="app-muted">No saved revisions yet.</p> : null}
          <ul className="kb-list">
            {revisions.map((rev, index) => (
              <li key={rev.id} className="soft-card" style={{ marginBottom: 8, padding: 14 }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "baseline" }}>
                  <strong>
                    {index === 0 ? "Current" : `Version ${revisions.length - index}`} ·{" "}
                    {new Date(rev.createdAt).toLocaleString()}
                  </strong>
                  <div className="kb-hero-actions">
                    <Button variant="secondary" type="button" onClick={() => setOpenId(openId === rev.id ? null : rev.id)}>
                      {openId === rev.id ? "Hide" : "View"}
                    </Button>
                    <Button variant="secondary" type="button" onClick={() => void copy(rev.content)}>
                      Copy
                    </Button>
                  </div>
                </div>
                <small className="app-muted">
                  {rev.editorEmail ?? "An admin"} · {rev.content.length.toLocaleString()} chars
                </small>
                {openId === rev.id ? (
                  <pre
                    style={{
                      marginTop: 8,
                      maxHeight: 320,
                      overflow: "auto",
                      padding: 12,
                      whiteSpace: "pre-wrap",
                      background: "var(--soft-bg, var(--app-bg))",
                      border: "1px solid var(--soft-line, var(--app-line))",
                      borderRadius: 12,
                      font: "12px/1.5 ui-monospace, monospace",
                    }}
                  >
                    {rev.content}
                  </pre>
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </main>
  );
}
