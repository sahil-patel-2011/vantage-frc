"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { askConfirm, Button } from "../../../components/ui";
import type { OutageClassification } from "../../../lib/outage/classify";

type Kind = "limited" | "recovered";
type Job = {
  kind: Kind;
  seq: number;
  total: number;
  sent: number;
  failed: number;
  nextIndex: number;
  startedAt: string;
  finishedAt: string | null;
  stalled: boolean;
};
type ConsoleData = {
  incidentId: string;
  linkExpiresAt: string;
  incident: {
    firstSeen: string;
    lastSeen: string;
    closedAt: string | null;
    failures: number;
    sources: string[];
    classification: OutageClassification;
  } | null;
  live: { database: "ok" | "unreachable"; checkedAt: string };
  notice: { limited: boolean; message?: string; since?: string };
  contacts: { count: number; refreshedAt: string } | null;
  sharedStore: boolean;
  jobs: Record<Kind, Job | null>;
  ownerConfigured: boolean;
  email: { configured: boolean; message?: string };
  defaults: Record<Kind, { subject: string; message: string }>;
};

function when(value: string | null | undefined) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

function since(value: string, now = Date.now()) {
  const minutes = Math.max(0, Math.round((now - Date.parse(value)) / 60_000));
  if (minutes < 1) return "under a minute";
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  return hours < 24 ? `${hours} h ${minutes % 60} min` : `${Math.floor(hours / 24)} d ${hours % 24} h`;
}

export function OutageConsole({ token }: { token: string }) {
  const [data, setData] = useState<ConsoleData | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [kind, setKind] = useState<Kind>("limited");
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  const edited = useRef(false);
  const chosen = useRef(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ tone: "ok" | "error"; text: string } | null>(null);

  const load = useCallback(async () => {
    const response = await fetch("/api/status/outage", {
      headers: { authorization: `Bearer ${token}` },
      cache: "no-store",
    }).catch(() => null);
    const body = response ? ((await response.json().catch(() => null)) as (ConsoleData & { error?: string }) | null) : null;
    if (!response?.ok || !body || body.error) {
      setLoadError(body?.error ?? "The console couldn't load. Check your connection and try again.");
      return;
    }
    setLoadError(null);
    setData(body);
  }, [token]);

  const sending = Boolean(data?.jobs[kind] && !data.jobs[kind]!.finishedAt && !data.jobs[kind]!.stalled);
  useEffect(() => {
    void load();
    const every = sending ? 3_000 : 20_000;
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") void load();
    }, every);
    return () => window.clearInterval(timer);
  }, [load, sending]);

  // First answer picks the likely message: "limited" while it is down, "back" once it answers.
  useEffect(() => {
    if (!data || chosen.current) return;
    chosen.current = true;
    const down = data.live.database !== "ok" || Boolean(data.incident && !data.incident.closedAt);
    setKind(down ? "limited" : "recovered");
  }, [data]);
  useEffect(() => {
    if (!data || edited.current) return;
    setSubject(data.defaults[kind].subject);
    setMessage(data.defaults[kind].message);
  }, [data, kind]);

  async function post(path: string, payload: Record<string, unknown>) {
    setBusy(true);
    setResult(null);
    const response = await fetch(path, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token, ...payload }),
    }).catch(() => null);
    const body = response ? ((await response.json().catch(() => null)) as Record<string, unknown> | null) : null;
    setBusy(false);
    if (!response?.ok) {
      setResult({ tone: "error", text: typeof body?.error === "string" ? body.error : "That didn't go through. Try again." });
      return null;
    }
    void load();
    return body ?? {};
  }

  async function send(audience: "everyone" | "owner", mode: "new" | "again" | "resume" = "new") {
    if (!data) return;
    const count = audience === "owner" ? 1 : (data.contacts?.count ?? 0);
    const who = audience === "owner" ? "only you" : `${count} ${count === 1 ? "person" : "people"}`;
    const ok = await askConfirm({
      title: mode === "resume" ? "Continue sending?" : `Email ${who}?`,
      body:
        audience === "owner"
          ? "One email to PLATFORM_OWNER_EMAIL, so you can see exactly what people would get."
          : `Every person on the contact list gets “${subject.trim()}” as their own email. ${
              kind === "limited" ? "The “Vantage is limited” banner turns on in the app." : "The banner turns off."
            } Type SEND to confirm.`,
      confirmLabel: mode === "again" ? "Send again" : mode === "resume" ? "Continue sending" : `Email ${who}`,
      tone: "critical",
      confirmPhrase: "SEND",
    });
    if (!ok) return;
    const body = await post("/api/status/outage/broadcast", {
      kind,
      audience,
      subject,
      message,
      confirm: "SEND",
      ...(mode === "again" ? { again: true } : {}),
      ...(mode === "resume" ? { resume: true } : {}),
    });
    if (body) {
      setResult({
        tone: "ok",
        text: audience === "owner" ? "Sent to you." : "Sending now. This page shows the progress.",
      });
    }
  }

  async function banner(on: boolean) {
    const body = await post("/api/status/outage/banner", { on, ...(on ? { message } : {}) });
    if (body) setResult({ tone: "ok", text: on ? "The banner is on." : "The banner is off." });
  }

  if (!data) {
    return (
      <main className="outage-console">
        <p className="outage-console-brand">Vantage</p>
        <h1>Outage console</h1>
        <p className="outage-console-lead" role="status">{loadError ?? "Checking the database…"}</p>
        {loadError ? <Button variant="secondary" onClick={() => void load()}>Try again</Button> : null}
      </main>
    );
  }

  const incident = data.incident;
  const c = incident?.classification;
  const up = data.live.database === "ok";
  const job = data.jobs[kind];
  const contacts = data.contacts;

  return (
    <main className="outage-console">
      <p className="outage-console-brand">Vantage</p>
      <h1>Outage console</h1>
      <p className={`outage-console-live ${up ? "is-up" : "is-down"}`} role="status">
        <strong>{up ? "The database is answering." : "The database isn't answering."}</strong>{" "}
        <span>Checked {when(data.live.checkedAt)}.</span>{" "}
        <button type="button" className="outage-console-link" onClick={() => void load()}>Check again</button>
      </p>

      <section className="outage-console-card" aria-labelledby="outage-what">
        <h2 id="outage-what">What happened</h2>
        {incident && c ? (
          <>
            <p className="outage-console-title">{c.title}</p>
            <dl>
              <dt>Why</dt>
              <dd>{c.why}</dd>
              <dt>What to try</dt>
              <dd>{c.fix}</dd>
              {c.errorCode || c.host ? (
                <>
                  <dt>Error</dt>
                  <dd>{[c.errorCode, c.host].filter(Boolean).join(" · ")}{c.detail ? ` — ${c.detail}` : ""}</dd>
                </>
              ) : null}
              <dt>First seen</dt>
              <dd>{when(incident.firstSeen)} ({since(incident.firstSeen)} ago)</dd>
              <dt>{incident.closedAt ? "Back since" : "Last failure"}</dt>
              <dd>{incident.closedAt ? `${when(incident.closedAt)} — down for ${since(incident.firstSeen, Date.parse(incident.closedAt))}` : when(incident.lastSeen)}</dd>
              <dt>Failed checks</dt>
              <dd>{incident.failures} (from {incident.sources.join(", ") || "the app"})</dd>
            </dl>
          </>
        ) : (
          <p className="outage-console-muted">
            This server has no record of the outage.
            {data.sharedStore ? "" : " Without a shared outage store (OUTAGE_REDIS_URL), each server keeps its own, so details can be missing here."}
          </p>
        )}
        <p className="outage-console-muted">
          Still working: scouting keeps saving on phones and syncs later, and each team&rsquo;s spreadsheet copy stays readable.
        </p>
      </section>

      <section className="outage-console-card" aria-labelledby="outage-email">
        <h2 id="outage-email">Email everyone</h2>
        <div className="outage-console-kinds" role="radiogroup" aria-label="Which message">
          {(["limited", "recovered"] as const).map((option) => (
            <label key={option}>
              <input type="radio" name="kind" checked={kind === option} onChange={() => { edited.current = false; setKind(option); }} />
              {option === "limited" ? "Vantage is limited" : "Vantage is back"}
            </label>
          ))}
        </div>
        <label className="outage-console-field">
          Subject
          <input value={subject} maxLength={160} onChange={(event) => { edited.current = true; setSubject(event.target.value); }} />
        </label>
        <label className="outage-console-field">
          Message
          <textarea rows={5} value={message} maxLength={4000} onChange={(event) => { edited.current = true; setMessage(event.target.value); }} />
        </label>
        {!data.email.configured ? <p className="outage-console-warn">{data.email.message}</p> : null}
        {contacts ? (
          <p className="outage-console-muted">
            Contact list: {contacts.count} {contacts.count === 1 ? "person" : "people"}, saved {since(contacts.refreshedAt)} ago. Each gets their own email.
          </p>
        ) : (
          <p className="outage-console-warn">
            There&rsquo;s no saved contact list{data.sharedStore ? "" : " on this server"}, so everyone can&rsquo;t be emailed from here. It is saved
            automatically while a platform admin is signed in and the database works{data.sharedStore ? "" : ", once OUTAGE_REDIS_URL and OUTAGE_REDIS_TOKEN are set"}.
            You can still email yourself and forward it.
          </p>
        )}
        {job ? (
          <p className="outage-console-muted" role="status">
            {job.finishedAt
              ? `Sent ${when(job.finishedAt)}: ${job.sent} of ${job.total} delivered${job.failed ? `, ${job.failed} failed` : ""}.`
              : job.stalled
                ? `Stopped after ${job.nextIndex} of ${job.total}.`
                : `Sending… ${job.nextIndex} of ${job.total}.`}
          </p>
        ) : null}
        <div className="outage-console-actions">
          {contacts && !(job && !job.finishedAt && !job.stalled) ? (
            <Button variant="primary" disabled={busy || !data.email.configured} onClick={() => void send("everyone", job ? "again" : "new")}>
              {job ? "Send again" : `Email ${contacts.count} ${contacts.count === 1 ? "person" : "people"}`}
            </Button>
          ) : null}
          {job?.stalled ? (
            <Button variant="secondary" disabled={busy} onClick={() => void send("everyone", "resume")}>
              Continue sending ({job.total - job.nextIndex} left)
            </Button>
          ) : null}
          {data.ownerConfigured ? (
            <Button variant={contacts ? "ghost" : "primary"} disabled={busy || !data.email.configured} onClick={() => void send("owner")}>
              {contacts ? "Send a test to me" : "Email only me"}
            </Button>
          ) : null}
        </div>
      </section>

      <section className="outage-console-card" aria-labelledby="outage-banner">
        <h2 id="outage-banner">Banner in the app</h2>
        <p className="outage-console-muted">
          {data.notice.limited
            ? `On since ${when(data.notice.since)}: “${data.notice.message}”`
            : "Off. Sending “Vantage is limited” turns it on with your message; “Vantage is back” turns it off."}
        </p>
        <div className="outage-console-actions">
          {data.notice.limited ? (
            <Button variant="secondary" disabled={busy} onClick={() => void banner(false)}>Turn off the banner</Button>
          ) : (
            <Button variant="ghost" disabled={busy} onClick={() => void banner(true)}>Turn on the banner without emailing</Button>
          )}
        </div>
      </section>

      {result ? (
        <p className={`outage-console-result is-${result.tone}`} role={result.tone === "error" ? "alert" : "status"}>{result.text}</p>
      ) : null}
      <p className="outage-console-muted">This link works until {when(data.linkExpiresAt)}. Don&rsquo;t forward it: anyone with it can email everyone.</p>
    </main>
  );
}
