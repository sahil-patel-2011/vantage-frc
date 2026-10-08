"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "../../components/ui";
import { PROVISIONING_FACTS, PROVISIONING_PHASES, workspaceReady, type ProvisioningStatus } from "../../lib/provisioning/model";
import { hostedBackgroundWorkEnabled } from "../../lib/hosted-background-work";

export function ProvisioningClient({ orgId, initial, canResume }: { orgId: string; initial: ProvisioningStatus; canResume: boolean }) {
  const router = useRouter();
  const backgroundEnabled = hostedBackgroundWorkEnabled();
  const [job, setJob] = useState(initial);
  const [tip, setTip] = useState(0);
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const [retrying, setRetrying] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    async function refresh() {
      try {
        const response = await fetch(`/api/organizations/provisioning?orgId=${encodeURIComponent(orgId)}`, { signal: AbortSignal.any([controller.signal, AbortSignal.timeout(10_000)]), cache: "no-store" });
        if (!response.ok) throw new Error("Setup status is unavailable. We will try again.");
        const next = await response.json() as ProvisioningStatus;
        if (controller.signal.aborted) return;
        setJob(next);
        setConnectionError(null);
        if (workspaceReady(next)) {
          router.replace(`/dashboard?orgId=${encodeURIComponent(orgId)}`);
          return;
        }
      } catch {
        if (!controller.signal.aborted) setConnectionError("Waiting for a connection. Your setup progress is saved.");
      }
      if (!controller.signal.aborted && backgroundEnabled) timer = setTimeout(() => void refresh(), 2000);
    }
    void refresh();
    return () => { controller.abort(); clearTimeout(timer); };
  }, [orgId, router, backgroundEnabled]);
  useEffect(() => {
    const timer = setInterval(() => setTip((value) => (value + 1) % PROVISIONING_FACTS.length), 12000);
    return () => clearInterval(timer);
  }, []);
  async function retry() {
    if (retrying || !canResume) return;
    setRetrying(true);
    try {
      const response = await fetch("/api/organizations/provisioning", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ orgId }), signal: AbortSignal.timeout(20_000) });
      const result = await response.json() as { workspaceReady?: boolean; error?: string };
      if (!response.ok) throw new Error(result.error ?? "Could not resume setup. Refresh for the latest status or contact support.");
      if (result.workspaceReady) { router.replace(`/dashboard?orgId=${encodeURIComponent(orgId)}`); return; }
      setJob((current) => ({ ...current, state: "queued", error: null, retryAfterAt: null }));
      setConnectionError(null);
    } catch (error) { setConnectionError((error as Error).message); }
    finally { setRetrying(false); }
  }
  const phase = PROVISIONING_PHASES.find((item) => item.id === job.phase);
  return <main className="provisioning-page">
    <div className="provisioning-card">
      <svg className={`provisioning-ring ${!backgroundEnabled || job.state === "failed" || job.state === "waiting" ? "is-stopped" : ""}`} viewBox="0 0 80 80" aria-hidden="true">
        <circle className="ring-track" cx="40" cy="40" r="32" />
        <circle className="ring-motion" cx="40" cy="40" r="32" />
      </svg>
      <h1>{!backgroundEnabled ? "Finish setting up your team" : job.state === "failed" ? "Your setup needs attention" : job.state === "waiting" ? "Your setup is waiting" : "Setting up your team"}</h1>
      <p className="app-muted">You can refresh or leave this page; progress is saved.</p>
      <p role="status" aria-live="polite">{!backgroundEnabled ? canResume ? "Finish the scouting forms and team tools to open your workspace." : "Ask a team owner or admin to finish setting up this workspace." : job.state === "failed" || job.state === "waiting" ? job.error : phase?.label ?? "Checking your setup"}</p>
      {backgroundEnabled && job.state === "waiting" && job.retryAfterAt ? <p>Next automatic attempt: <time dateTime={job.retryAfterAt}>{new Date(job.retryAfterAt).toISOString().replace("T", " ").replace(".000Z", " UTC")}</time></p> : null}
      <ol className="provisioning-phases" aria-label="Setup phases">
        {PROVISIONING_PHASES.filter(item => item.id === "team" || item.id === "tools").map((item) => <li key={item.id} aria-current={item.id === job.phase ? "step" : undefined}>
          <span aria-hidden="true">{job.completedPhases.includes(item.id) ? "✓" : "○"}</span>
          {item.label}<span className="app-muted">{job.completedPhases.includes(item.id) ? "Done" : !backgroundEnabled ? "Needs setup" : item.id === job.phase ? job.state === "waiting" ? "Waiting" : job.state === "failed" ? "Needs attention" : "In progress" : "Waiting"}</span>
        </li>)}
      </ol>
      {connectionError ? <p role="alert">{connectionError}</p> : null}
      {canResume && (!backgroundEnabled || job.state === "failed") ? <Button variant="primary" disabled={retrying} onClick={() => void retry()}>{retrying ? "Resuming…" : backgroundEnabled ? "Retry setup" : "Finish setup"}</Button> : null}
      <p className="provisioning-tip">{PROVISIONING_FACTS[tip]}</p>
      <a href="mailto:vantagefrc@gmail.com">Contact support</a>
    </div>
  </main>;
}
