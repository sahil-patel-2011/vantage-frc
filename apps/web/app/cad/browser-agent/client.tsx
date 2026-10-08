"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { Button } from "../../../components/ui/button";
import { withOrgHref } from "../../../lib/nav/product-nav";
import NativeCadChat, { type NativeCadTools } from "./native-chat";
import styles from "./browser-agent.module.css";

type Device = { id: string; name: string };
type DesktopStatus = {
  phase: "setup_required" | "idle" | "starting" | "browser_open" | "stopping" | "error";
  message: string;
  orgId?: string;
};
type DesktopCadBridge = {
  status(): Promise<DesktopStatus>;
  start(input: { orgId: string; url?: string }): Promise<DesktopStatus>;
  stop(): Promise<DesktopStatus>;
  onState(callback: (status: DesktopStatus) => void): () => void;
  tool?: NativeCadTools["tool"];
};
type View =
  | { status: "loading" }
  | { status: "blocked" | "error"; message: string; signIn?: boolean }
  | { status: "desktop"; bridge: DesktopCadBridge }
  | { status: "ready"; devices: Device[] }
  | { status: "approved"; deviceName: string };

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : null;
}

function messageFrom(body: unknown, fallback: string): string {
  const result = record(body);
  return typeof result?.error === "string" ? result.error
    : typeof result?.message === "string" ? result.message : fallback;
}

function readDevices(body: unknown): Device[] | null {
  const devices = record(body)?.devices;
  if (!Array.isArray(devices)) return null;
  if (!devices.every((device: unknown) => {
    const row = record(device);
    return typeof row?.id === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(row.id) && typeof row.name === "string";
  })) return null;
  return devices as Device[];
}

function desktopBridge(): DesktopCadBridge | null {
  const cad = (window as unknown as { vantageDesktop?: { cad?: DesktopCadBridge } }).vantageDesktop?.cad;
  return cad && [cad.status, cad.start, cad.stop, cad.onState].every((method) => typeof method === "function") ? cad : null;
}

export default function BrowserAgentClient({ orgId }: { orgId: string }) {
  // Remount on team changes so neither a selection nor a late result crosses teams.
  return <Authorization key={orgId} orgId={orgId} />;
}

function Authorization({ orgId }: { orgId: string }) {
  const [view, setView] = useState<View>({ status: "loading" });
  const [deviceId, setDeviceId] = useState("");
  const [attempt, setAttempt] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const mutation = useRef<AbortController | null>(null);
  const connectionsHref = withOrgHref("/cad/connections", orgId);

  useEffect(() => {
    const controller = new AbortController();
    const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(15_000)]);
    setView({ status: "loading" });
    setDeviceId("");
    setError("");
    void (async () => {
      try {
        const query = `?orgId=${encodeURIComponent(orgId)}`;
        const access = await fetch(`/api/cad/browser-agent/access${query}`, { cache: "no-store", signal });
        const body: unknown = await access.json().catch(() => null);
        if (controller.signal.aborted) return;
        const result = record(body);
        if (!access.ok || result?.allowed !== true || result.status !== "eligible") {
          setView({ status: access.status === 401 || access.status === 403 || result?.status === "setup_required" ? "blocked" : "error",
            message: messageFrom(body, "Your pilot eligibility could not be confirmed."), signIn: access.status === 401 });
          return;
        }
        const bridge = desktopBridge();
        if (bridge) {
          setView({ status: "desktop", bridge });
          return;
        }
        const enrollment = await fetch(`/api/cad/browser-agent/enroll${query}`, { cache: "no-store", signal });
        const devicesBody: unknown = await enrollment.json().catch(() => null);
        if (controller.signal.aborted) return;
        const devices = readDevices(devicesBody);
        if (!enrollment.ok || !devices) {
          setView({ status: enrollment.status === 401 || enrollment.status === 403 ? "blocked" : "error",
            message: messageFrom(devicesBody, "Your paired computers could not be loaded."), signIn: enrollment.status === 401 });
          return;
        }
        setView({ status: "ready", devices });
        if (devices.length === 1) setDeviceId(devices[0]!.id);
      } catch {
        if (!controller.signal.aborted) setView({ status: "error", message: "Could not reach Vantage. Check your connection and try again." });
      }
    })();
    return () => controller.abort();
  }, [orgId, attempt]);

  useEffect(() => () => mutation.current?.abort(), []);

  async function approve(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (mutation.current || view.status !== "ready") return;
    const selected = view.devices.find((device) => device.id === deviceId);
    if (!selected) return;
    const controller = new AbortController();
    mutation.current = controller;
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/cad/browser-agent/enroll", {
        method: "POST", cache: "no-store", headers: { "content-type": "application/json" },
        body: JSON.stringify({ orgId, deviceId: selected.id }),
        signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15_000)]),
      });
      const body: unknown = await response.json().catch(() => null);
      if (controller.signal.aborted) return;
      if (!response.ok || record(body)?.approved !== true) {
        if (response.status === 401) {
          setView({ status: "blocked", signIn: true, message: "Sign in again to authorize this computer." });
          return;
        }
        setError(messageFrom(body, "Device authorization was not confirmed. Try again."));
        return;
      }
      setView({ status: "approved", deviceName: selected.name || "Your computer" });
    } catch {
      if (!controller.signal.aborted) setError("Authorization could not be confirmed. Check your connection, then retry for this same computer.");
    } finally {
      if (!controller.signal.aborted) setBusy(false);
      if (mutation.current === controller) mutation.current = null;
    }
  }

  return (
    <section className={styles.card} aria-labelledby="pilot-authorization-title" aria-busy={view.status === "loading" || busy}>
      <header>
        <span className={styles.eyebrow}>WA Robotics · Team 6925</span>
        <h2 id="pilot-authorization-title">{view.status === "approved" ? "Computer approved" : view.status === "desktop" ? "Your workspace" : view.status === "loading" ? "Preparing your workspace" : view.status === "blocked" ? "Access needed" : view.status === "error" ? "Let’s reconnect" : "Approve your computer"}</h2>
      </header>
      <div aria-live="polite" aria-atomic="true">
        {view.status === "loading" ? <p>Checking your team membership…</p> : null}
        {view.status === "blocked" || view.status === "error" ? <p>{view.message}</p> : null}
        {view.status === "approved" ? <div className={styles.success}><p><strong>{view.deviceName}</strong> is approved for this sign-in.</p><p className={styles.note}>Return to your desktop connector to continue. Approval ends when this sign-in expires or is revoked.</p></div> : null}
      </div>
      {view.status === "desktop" ? <DesktopControl orgId={orgId} bridge={view.bridge} /> : null}
      {view.status === "ready" && view.devices.length > 0 ? (
        <form onSubmit={approve} className={styles.form}>
          <p>Choose your paired computer to approve the Onshape pilot for this sign-in.</p>
          <label htmlFor="browser-pilot-device">Your computer</label>
          <select id="browser-pilot-device" value={deviceId} onChange={(event) => setDeviceId(event.target.value)} required disabled={busy}>
            <option value="" disabled>Choose a computer</option>
            {view.devices.map((device) => <option key={device.id} value={device.id}>{device.name || "Unnamed computer"} · {device.id.slice(-6)}</option>)}
          </select>
          <p className={styles.note}>Your desktop connector opens Onshape separately, when you choose to start.</p>
          {error ? <p role="alert" className={styles.error}>{error}</p> : null}
          <Button type="submit" variant="primary" disabled={busy || !deviceId}>{busy ? "Approving…" : "Approve computer"}</Button>
        </form>
      ) : null}
      {view.status === "ready" && view.devices.length === 0 ? (
        <div className={styles.empty}>
          <h3>No paired computer yet</h3>
          <p>Your team has access. Pair an Onshape connector from CAD connections when a pilot build is available.</p>
          <p className={styles.note}>The desktop release is still in development.</p>
        </div>
      ) : null}
      <footer className={styles.footer}>
        {view.status === "error" || view.status === "blocked" ? view.signIn
          ? <Button as="a" variant="primary" href={`/signin?next=${encodeURIComponent(withOrgHref("/cad/browser-agent", orgId))}`}>Sign in</Button>
          : <Button variant="secondary" onClick={() => setAttempt((value) => value + 1)}>Check again</Button> : null}
        <a href={connectionsHref}>CAD connections</a>
      </footer>
    </section>
  );
}

function DesktopControl({ orgId, bridge }: { orgId: string; bridge: DesktopCadBridge }) {
  const [status, setStatus] = useState<DesktopStatus | null>(null);
  const [url, setUrl] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [taskRunning, setTaskRunning] = useState(false);
  const pending = useRef(false);
  const operationVersion = useRef(0);
  const alive = useRef(true);
  const documentOptions = useRef<HTMLDetailsElement | null>(null);
  const documentInput = useRef<HTMLInputElement | null>(null);
  const phaseLabel = status?.phase === "idle" ? "Ready to open" : status?.phase === "starting" ? "Opening Onshape"
    : status?.phase === "browser_open" ? "Browser open" : status?.phase === "stopping" ? "Closing browser"
      : status?.phase === "setup_required" ? "Setup needed" : status?.phase === "error" ? "Needs attention" : "Checking availability";

  useEffect(() => {
    alive.current = true;
    let active = true;
    let eventReceived = false;
    const unsubscribe = bridge.onState((next) => {
      eventReceived = true;
      if (active) setStatus(next);
    });
    void bridge.status().then((next) => {
      if (active && !eventReceived) setStatus(next);
    }).catch(() => {
      if (active) setError("The desktop connector could not be checked. Reopen this page to try again.");
    });
    return () => { active = false; alive.current = false; unsubscribe(); };
  }, [bridge]);

  async function act(action: "start" | "stop") {
    if (!status || (action === "start" && (pending.current || status.phase !== "idle")) ||
      (action === "stop" && (status.phase === "stopping" || (pending.current && status.phase !== "starting")))) return;
    let documentUrl: string | undefined;
    if (action === "start" && url.trim()) {
      try {
        const parsed = new URL(url.trim());
        if (parsed.origin !== "https://cad.onshape.com" || parsed.username || parsed.password || !/^\/documents(?:\/|$)/.test(parsed.pathname)) throw new Error("Invalid URL");
        documentUrl = parsed.href;
      } catch {
        setError("Use an Onshape document or Documents page link beginning with https://cad.onshape.com/documents.");
        if (documentOptions.current) documentOptions.current.open = true;
        documentInput.current?.focus();
        return;
      }
    }
    pending.current = true;
    const version = ++operationVersion.current;
    setBusy(true);
    setError("");
    try {
      const next = action === "start" ? await bridge.start({ orgId, ...(documentUrl ? { url: documentUrl } : {}) }) : await bridge.stop();
      if (alive.current && version === operationVersion.current) setStatus(next);
    } catch {
      if (alive.current && version === operationVersion.current) setError(action === "start" ? "The Onshape browser could not be opened. Check your team sign-in and try again." : "The browser could not be stopped. Check the desktop app and try again.");
    } finally {
      if (version === operationVersion.current) {
        pending.current = false;
        if (alive.current) setBusy(false);
      }
    }
  }

  return (
    <div className={styles.desktop} aria-busy={busy}>
      <div className={styles.connection}>
        <div className={styles.connectionIdentity}>
          <svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="3" /><path d="M3 9h18M7 6.5h.01M10 6.5h.01" /></svg>
          <div><strong>Onshape</strong><span className={styles.connectionState} data-phase={status?.phase} role="status" aria-live="polite">{phaseLabel}</span></div>
        </div>
        {status?.phase === "browser_open" && !taskRunning ? <Button variant="ghost" onClick={() => void act("stop")} disabled={busy}>{busy ? "Closing…" : "Close browser"}</Button> : null}
        {status?.phase === "starting" ? <Button variant="ghost" onClick={() => void act("stop")}>Cancel opening</Button> : null}
      </div>
      {status?.phase === "setup_required" ? <div className={styles.empty}><h3>Browser CAD is not included in this build</h3><p>You’ll need a desktop pilot build with the Onshape browser included. The packaged release is not available yet.</p><p className={styles.note}>Nothing has been installed or started.</p></div> : null}
      {status?.phase === "idle" ? (
        <form className={styles.form} noValidate onSubmit={(event) => { event.preventDefault(); void act("start"); }}>
          <p>Open Onshape, sign in there, then choose the document you want to work on.</p>
          <details ref={documentOptions} className={styles.details}>
            <summary>Open a specific document</summary>
            <div className={styles.detailContent}>
              <label htmlFor="pilot-onshape-url">Onshape link</label>
              <input ref={documentInput} id="pilot-onshape-url" type="url" value={url} onChange={(event) => setUrl(event.target.value)} disabled={busy}
                placeholder="https://cad.onshape.com/documents/…" aria-describedby="pilot-onshape-url-help" autoComplete="off" spellCheck={false} />
              <p id="pilot-onshape-url-help" className={styles.note}>Optional. Leave blank to open your Documents page.</p>
            </div>
          </details>
          <Button type="submit" variant="primary" disabled={busy}>{busy ? "Opening…" : "Open Onshape"}</Button>
        </form>
      ) : null}
      {status?.phase === "browser_open" ? (
        <p className={styles.note}>{status.orgId && status.orgId !== orgId ? "This browser belongs to another team. Close it before opening this workspace." : "Sign in to Onshape and choose a document, then describe your task below."}</p>
      ) : null}
      {status?.phase === "error" ? <div className={styles.empty}><p>{status.message}</p><Button variant="secondary" onClick={() => void act("stop")} disabled={busy}>{busy ? "Resetting…" : "Reset browser"}</Button></div> : null}
      {error ? <p role="alert" className={styles.error}>{error}</p> : null}
      {typeof bridge.tool === "function" ? <NativeCadChat orgId={orgId} bridge={bridge as DesktopCadBridge & NativeCadTools}
        ready={status?.phase === "browser_open" && status.orgId === orgId} onRunningChange={setTaskRunning} /> : null}
    </div>
  );
}
