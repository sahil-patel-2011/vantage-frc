"use client";

import { useEffect, useState } from "react";
import { Button } from "../../components/ui";
import { FEATURE_API_TIMEOUT_MS } from "../../lib/nav/resolve-org";

export function IntelLookupNotes({ orgId, teamKey }: { orgId: string; teamKey: string }) {
  const [draft, setDraft] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [setup, setSetup] = useState(false);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState("");

  useEffect(() => {
    let cancelled = false;
    setLoaded(false);
    setSetup(false);
    setStatus("");
    void (async () => {
      try {
        const response = await fetch(
          `/api/intel/notes?orgId=${encodeURIComponent(orgId)}&teamKey=${encodeURIComponent(teamKey)}`,
          { signal: AbortSignal.timeout(FEATURE_API_TIMEOUT_MS) },
        );
        const data = (await response.json()) as { note?: { body?: string } | null; setup?: boolean; error?: string };
        if (cancelled) return;
        if (data.setup) {
          setSetup(true);
          setDraft("");
          setLoaded(true);
          return;
        }
        if (!response.ok) {
          setStatus(data.error ?? "Could not load notes.");
          setLoaded(true);
          return;
        }
        setDraft(data.note?.body ?? "");
        setLoaded(true);
      } catch {
        if (!cancelled) {
          setStatus("Could not load notes.");
          setLoaded(true);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [orgId, teamKey]);

  async function save() {
    setSaving(true);
    setStatus("");
    try {
      const response = await fetch("/api/intel/notes", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        signal: AbortSignal.timeout(FEATURE_API_TIMEOUT_MS),
        body: JSON.stringify({ orgId, teamKey, body: draft }),
      });
      const data = (await response.json()) as { setup?: boolean; error?: string };
      if (data.setup) {
        setSetup(true);
        setStatus("");
        return;
      }
      setStatus(response.ok ? "Saved." : (data.error ?? "Could not save notes."));
    } catch {
      setStatus("Could not save notes.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="intel-lookup-notes" aria-label="Lookup notes">
      <header>
        <h4>Notes</h4>
        <p className="app-muted">Shared with this team. Blank until someone writes one.</p>
      </header>
      {setup ? (
        <p className="intel-lookup-empty">Needs setup — lookup notes are not on this database yet.</p>
      ) : (
        <>
          <textarea
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            rows={4}
            maxLength={4000}
            disabled={!loaded}
            aria-label="Lookup notes"
            placeholder="What this robot does well, and what to watch for."
          />
          <div className="intel-lookup-notes-row">
            <Button variant="secondary" type="button" onClick={() => void save()} disabled={!loaded || saving}>
              Save notes
            </Button>
            {status ? <small className="app-muted">{status}</small> : null}
          </div>
        </>
      )}
    </section>
  );
}
