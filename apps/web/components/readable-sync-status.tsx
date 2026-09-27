"use client";
import { useEffect, useState } from "react";

type HubStatus = { configured: boolean; job: null | { state: string; error: string | null; lastVerifiedAt: string | null; retryAfterAt: string | null; completed: number; ageSeconds: number | null } };
/** Operational facts only: never exposes operator Drive links, keys or private records. */
export function ReadableSyncStatus({ orgId }: { orgId: string }) {
  const [status, setStatus] = useState<{ orgId: string; data: HubStatus } | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    const refresh = async () => {
      try {
        const response = await fetch(`/api/integrations/sheets/hub-status?orgId=${encodeURIComponent(orgId)}`, { cache: "no-store", signal: controller.signal });
        if (!response.ok) throw new Error("Status unavailable");
        const data = await response.json() as HubStatus;
        if (active) { setStatus({ orgId, data }); setFailed(false); }
      } catch { if (active) setFailed(true); }
    };
    void refresh();
    const interval = setInterval(() => void refresh(), 30_000);
    return () => { active = false; controller.abort(); clearInterval(interval); };
  }, [orgId]);
  const current = status?.orgId === orgId ? status.data : null;
  const job = current?.job;
  return <section className="panel" aria-label="Google workbook status">
    <h2>Google workbook status</h2>
    {failed ? <p role="status">Status is unavailable. Your previous copy has not been confirmed.</p>
      : !current ? <p>Checking your team’s readable copy…</p>
      : !current.configured ? <p>Needs attention: the operator’s Google connection is unavailable.</p>
      : !job ? <p>Waiting for the first automatic refresh.</p>
      : <>
        <p>{job.state === "ready" ? "Readable workbooks checked" : job.state === "failed" ? "Needs attention" : job.state === "waiting" ? "Waiting for Google" : "Refreshing workbooks"}{job.state !== "ready" && ` · ${job.completed} of 5 checked`}</p>
        {job.lastVerifiedAt ? <p>Data checked {new Date(job.lastVerifiedAt).toLocaleString()}{job.ageSeconds !== null ? ` · ${Math.floor(job.ageSeconds / 60)} minutes ago` : ""}.</p> : <p>A complete refresh has not been verified yet.</p>}
        {job.ageSeconds !== null && job.ageSeconds > 300 && <p role="status">The readable copy is more than five minutes behind. Saved application data remains in PostgreSQL.</p>}
        {job.error && <p role="status">{job.error}</p>}
        {job.retryAfterAt && <p>Next provider retry: {new Date(job.retryAfterAt).toLocaleString()}.</p>}
      </>}
    <p>This status covers the five readable workbooks. Protected recovery has separate verification.</p>
  </section>;
}
