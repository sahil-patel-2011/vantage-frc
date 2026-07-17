"use client";

import type { SchemaDefinition, ScoutSchema, SyncEntry } from "@vantage/scouting";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import {
  cacheEvent,
  getCachedEvent,
  pendingCounts,
  queueEntry,
  queueMedia,
  stableClientId,
  syncMediaOutbox,
  syncOutbox,
} from "../../lib/scout-offline";

type Bootstrap = {
  eventKey: string | null;
  schemas: ScoutSchema[];
  canManageSchemas?: boolean;
  assignments: Array<{
    matchKey: string;
    teamKey: string;
    compLevel: string;
    matchNumber: number;
  }>;
  matches: Array<{
    matchKey: string;
    matchNumber: number;
    compLevel?: string;
    redAlliance?: { teamKeys?: string[] };
    blueAlliance?: { teamKeys?: string[] };
  }>;
  recentEntries: Array<{
    id: string;
    type: string;
    matchKey: string | null;
    teamKey: string;
    confidence: string;
    source: string;
    updatedAt: string;
    scoutName: string;
  }>;
};

type SpeechRecognitionLike = {
  continuous: boolean;
  interimResults: boolean;
  onresult: (event: { results: ArrayLike<{ 0: { transcript: string } }> }) => void;
  onend: () => void;
  start(): void;
};

export default function ScoutingClient({ orgId }: { orgId: string }) {
  const searchParams = useSearchParams();
  const [data, setData] = useState<Bootstrap | null>(null);
  const [type, setType] = useState<"match" | "pit">("match");
  const [matchKey, setMatchKey] = useState("");
  const [teamKey, setTeamKey] = useState("");
  const [payload, setPayload] = useState<Record<string, unknown>>({});
  const [confidence, setConfidence] = useState<"high" | "normal" | "low">("normal");
  const [source, setSource] = useState<"manual" | "voice">("manual");
  const [voiceDraft, setVoiceDraft] = useState("");
  const [online, setOnline] = useState(true);
  const [counts, setCounts] = useState({ entries: 0, media: 0 });
  const [message, setMessage] = useState("");
  const [conflicts, setConflicts] = useState<Array<Record<string, unknown>>>([]);
  const [formulaName, setFormulaName] = useState("");
  const [formulaWeights, setFormulaWeights] = useState<Record<string, number>>({});

  const refreshCounts = useCallback(async () => setCounts(await pendingCounts()), []);
  const sync = useCallback(async () => {
    if (!orgId || !navigator.onLine) return;
    try {
      const entries = await syncOutbox(orgId);
      const media = await syncMediaOutbox(orgId);
      if (entries || media) setMessage(`Synced ${entries} entries and ${media} media files`);
      await refreshCounts();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Sync paused");
    }
  }, [orgId, refreshCounts]);

  useEffect(() => {
    setOnline(navigator.onLine);
    void (async () => {
      const cached = await getCachedEvent<Bootstrap>(orgId);
      if (cached) setData(cached);
      try {
        const response = await fetch(`/api/scouting/bootstrap?orgId=${encodeURIComponent(orgId)}`);
        if (response.ok) {
          const fresh = (await response.json()) as Bootstrap;
          setData(fresh);
          await cacheEvent(orgId, fresh);
        }
      } catch {
        setMessage(cached ? "Using cached event data" : "No cached event data available");
      }
      await refreshCounts();
      await sync();
    })();
    const handleOnline = () => {
      setOnline(true);
      void sync();
    };
    const handleOffline = () => setOnline(false);
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, [orgId, refreshCounts, sync]);

  useEffect(() => {
    const deepMatch = searchParams.get("matchKey");
    const deepTeam = searchParams.get("teamKey");
    if (deepMatch) setMatchKey(deepMatch);
    if (deepTeam) setTeamKey(deepTeam);
  }, [searchParams]);

  useEffect(() => {
    const assignment = data?.assignments[0];
    if (assignment && !matchKey && !searchParams.get("matchKey")) {
      setMatchKey(assignment.matchKey);
      setTeamKey(assignment.teamKey);
    }
  }, [data, matchKey, searchParams]);

  const matchOptions = useMemo(() => {
    if (!data) return [];
    if (data.assignments.length) {
      return data.assignments.map((assignment) => ({
        matchKey: assignment.matchKey,
        teamKey: assignment.teamKey,
        label: `${assignment.compLevel.toUpperCase()} ${assignment.matchNumber} · ${assignment.teamKey}`,
      }));
    }
    const options: Array<{ matchKey: string; teamKey: string; label: string }> = [];
    for (const match of data.matches) {
      const teams = [
        ...(match.redAlliance?.teamKeys ?? []),
        ...(match.blueAlliance?.teamKeys ?? []),
      ];
      const comp = match.compLevel?.toUpperCase() ?? "MATCH";
      for (const teamKey of teams) {
        options.push({
          matchKey: match.matchKey,
          teamKey,
          label: `${comp} ${match.matchNumber} · ${teamKey}`,
        });
      }
    }
    return options;
  }, [data]);

  const schema = useMemo(
    () => data?.schemas.find((candidate) => candidate.type === type),
    [data, type],
  );

  async function submit() {
    if (!data?.eventKey || !schema || !teamKey || (type === "match" && !matchKey)) {
      setMessage("Select an event assignment, team, and form");
      return;
    }
    const entry: SyncEntry = {
      clientId: stableClientId(),
      type,
      eventKey: data.eventKey,
      matchKey: type === "match" ? matchKey : undefined,
      teamKey,
      schemaId: schema.id,
      payload,
      confidence,
      source,
      updatedAt: new Date().toISOString(),
    };
    await queueEntry(entry);
    setPayload({});
    setVoiceDraft("");
    setMessage(online ? "Saved locally; syncing…" : "Saved offline; will sync on reconnect");
    await refreshCounts();
    await sync();
  }

  function startVoiceDraft() {
    const constructor = (
      window as typeof window & {
        SpeechRecognition?: new () => SpeechRecognitionLike;
        webkitSpeechRecognition?: new () => SpeechRecognitionLike;
      }
    ).SpeechRecognition ?? (
      window as typeof window & {
        webkitSpeechRecognition?: new () => SpeechRecognitionLike;
      }
    ).webkitSpeechRecognition;
    if (!constructor) {
      setMessage("Voice recognition is unavailable in this browser; type the draft instead");
      return;
    }
    const recognition = new constructor();
    recognition.continuous = false;
    recognition.interimResults = false;
    recognition.onresult = (event) => {
      const transcript = event.results[0]?.[0].transcript ?? "";
      setVoiceDraft(transcript);
      const draftField = schema?.definition.fields.find((field) => field.type === "text");
      if (draftField) {
        setPayload((current) => ({ ...current, [draftField.key]: transcript }));
      }
    };
    recognition.onend = () => setSource("voice");
    recognition.start();
    setMessage("Listening — review the draft before saving");
  }

  async function attachMedia(file: File) {
    if (!data?.eventKey || !teamKey) return;
    await queueMedia({
      clientId: stableClientId(),
      metadata: {
        eventKey: data.eventKey,
        teamKey,
        kind: file.type.startsWith("video/") ? "video" : "photo",
        contentType: file.type,
        byteSize: file.size,
        tags: ["pit"],
      },
      blob: file,
    });
    setMessage("Media queued separately for bandwidth-safe upload");
    await refreshCounts();
    await sync();
  }

  async function loadConflicts() {
    const response = await fetch(
      `/api/scouting/disagreements?orgId=${encodeURIComponent(orgId)}&eventKey=${encodeURIComponent(data?.eventKey ?? "")}`,
    );
    if (response.ok) setConflicts(((await response.json()) as { disagreements: [] }).disagreements);
  }

  async function saveFormula() {
    const terms = Object.entries(formulaWeights)
      .filter(([, weight]) => Number.isFinite(weight) && weight !== 0)
      .map(([field, weight]) => ({
        op: "multiply" as const,
        args: [
          { op: "field" as const, field },
          { op: "constant" as const, value: weight },
        ],
      }));
    if (!formulaName.trim() || !terms.length) {
      setMessage("Name the formula and set at least one field weight");
      return;
    }
    const response = await fetch("/api/scouting/formulas", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        orgId,
        name: formulaName,
        expression: { op: "add", args: terms },
      }),
    });
    setMessage(response.ok ? "Coach value formula saved" : "Coach role is required to save formulas");
  }

  async function createStarterForms() {
    setMessage("");
    const response = await fetch("/api/scouting/schemas", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ orgId, action: "ensure_defaults" }),
    });
    const payload = (await response.json().catch(() => ({}))) as Bootstrap & { error?: string };
    if (!response.ok) {
      setMessage(payload.error ?? "Could not create starter forms.");
      return;
    }
    setData(payload);
    await cacheEvent(orgId, payload);
    setMessage("Starter match and pit forms are ready.");
  }

  async function reviewConflict(id: string, status: "resolved" | "dismissed") {
    const response = await fetch("/api/scouting/disagreements", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ orgId, id, status, resolution: { reviewedIn: "scouting-ui" } }),
    });
    if (response.ok) await loadConflicts();
    else setMessage("Coach role is required to review conflicts");
  }

  return (
    <main className="scout-app">
      <header className="scout-header">
        <div>
          <span className="eyebrow">VANTAGE / SCOUT</span>
          <h1>Event scouting</h1>
          <p className="app-muted">Match and pit forms cache on this device. Empty until an active event and schema are set — no fake coverage.</p>
        </div>
        <div className={`network ${online ? "online" : "offline"}`}>
          {online ? "ONLINE" : "OFFLINE"} · {counts.entries} entries · {counts.media} media queued
        </div>
      </header>
      {!data?.eventKey ? (
        <section className="app-empty" style={{ marginBottom: 16 }}>
          <span className="app-badge setup">Setup required</span>
          <h2>No active event</h2>
          <p>Select an event in Command before assignments and forms can load. Offline queue still works once an event is cached.</p>
          <a className="app-button secondary" href={`/command?orgId=${encodeURIComponent(orgId)}`}>
            Select event
          </a>
        </section>
      ) : null}
      {data?.eventKey && !schema ? (
        <section className="app-empty" style={{ marginBottom: 16 }}>
          <span className="app-badge setup">Forms required</span>
          <h2>No {type} scouting form yet</h2>
          <p>
            {data.canManageSchemas
              ? "Create starter match and pit forms for this season, or publish a custom schema from Team settings."
              : "Ask an owner or admin to publish scouting forms for this event."}
          </p>
          {data.canManageSchemas ? (
            <button className="app-button secondary" type="button" onClick={() => void createStarterForms()}>
              Create starter forms
            </button>
          ) : null}
        </section>
      ) : null}
      <section className="event-strip">
        <strong>{data?.eventKey ?? "No active event"}</strong>
        <span>Forms and assignments are cached on this device.</span>
        <button onClick={() => void sync()}>Sync now</button>
      </section>
      <nav className="scout-tabs" aria-label="Scouting views">
        <button className={type === "match" ? "active" : ""} onClick={() => setType("match")}>Match</button>
        <button className={type === "pit" ? "active" : ""} onClick={() => setType("pit")}>Pit</button>
        <button onClick={() => void loadConflicts()}>Conflict review</button>
      </nav>
      {conflicts.length > 0 && (
        <section className="conflict-panel">
          <h2>Cross-scout disagreements</h2>
          {conflicts.map((conflict) => (
            <article key={String(conflict.id)}>
              <strong>{String(conflict.matchKey)} · {String(conflict.teamKey)}</strong>
              <span>{String(conflict.fieldKey)}: {JSON.stringify(conflict.values)}</span>
              <small>Status: {String(conflict.status)} · entry attribution retained</small>
              {conflict.status === "open" && <div><button onClick={() => void reviewConflict(String(conflict.id), "resolved")}>Resolve</button> <button onClick={() => void reviewConflict(String(conflict.id), "dismissed")}>Dismiss</button></div>}
            </article>
          ))}
        </section>
      )}
      <div className="scout-grid">
        <section className="scout-form">
          <div className="form-heading">
            <div><span className="eyebrow">PINNED FORM</span><h2>{schema?.definition.title ?? `No ${type} schema`}</h2></div>
            <span>v{schema?.version ?? "—"}</span>
          </div>
          {type === "match" && (
            <label>Assignment
              <select value={`${matchKey}|${teamKey}`} onChange={(event) => {
                const [match, team] = event.target.value.split("|");
                setMatchKey(match ?? "");
                setTeamKey(team ?? "");
              }}>
                <option value="|">Select match and team</option>
                {matchOptions.map((option) => (
                  <option key={`${option.matchKey}-${option.teamKey}`} value={`${option.matchKey}|${option.teamKey}`}>
                    {option.label}
                  </option>
                ))}
              </select>
              {!matchOptions.length ? (
                <small>No assignments or synced matches yet — sync TBA after the schedule is published.</small>
              ) : null}
            </label>
          )}
          {type === "pit" && <label>Team key<input value={teamKey} onChange={(event) => setTeamKey(event.target.value)} placeholder="frc254" /></label>}
          {schema?.definition.fields.map((field) => (
            <Field key={field.key} field={field} value={payload[field.key]} onChange={(value) => setPayload((current) => ({ ...current, [field.key]: value }))} />
          ))}
          <label>Scout confidence
            <select value={confidence} onChange={(event) => setConfidence(event.target.value as typeof confidence)}>
              <option value="high">High</option><option value="normal">Normal</option><option value="low">Low — downweighted</option>
            </select>
          </label>
          <div className="voice-box">
            <div><strong>Voice draft</strong><small>Transcription remains a draft until you confirm and save.</small></div>
            <button onClick={startVoiceDraft}>Record</button>
            <textarea value={voiceDraft} onChange={(event) => {
              const transcript = event.target.value;
              setVoiceDraft(transcript);
              setSource("voice");
              const draftField = schema?.definition.fields.find((field) => field.type === "text");
              if (draftField) setPayload((current) => ({ ...current, [draftField.key]: transcript }));
            }} placeholder="Voice notes (copied into the first text field)…" />
          </div>
          {type === "pit" && <label className="media-button">Queue pit photo/video<input type="file" accept="image/*,video/*" onChange={(event) => event.target.files?.[0] && void attachMedia(event.target.files[0])} /></label>}
          <button className="primary-action" onClick={() => void submit()}>Save {online ? "& sync" : "offline"}</button>
          {message && <p className="form-message" role="status">{message}</p>}
        </section>
        <aside className="activity-panel">
          <span className="eyebrow">ATTRIBUTION / LWW</span>
          <h2>Recent entries</h2>
          <p>Latest timestamp wins per stable client entry. Scout identity, confidence, source, and conflicts stay visible.</p>
          {data?.recentEntries.map((entry) => (
            <article key={entry.id}>
              <strong>{entry.matchKey ?? "PIT"} · {entry.teamKey}</strong>
              <span>{entry.scoutName} · {entry.source}</span>
              <small>{entry.confidence} confidence · {new Date(entry.updatedAt).toLocaleTimeString()}</small>
            </article>
          ))}
          <section className="formula-builder">
            <span className="eyebrow">COACH VALUE FORMULA</span>
            <h2>Weighted score</h2>
            <input aria-label="Formula name" placeholder="e.g. Pick value" value={formulaName} onChange={(event) => setFormulaName(event.target.value)} />
            {schema?.definition.fields.filter((field) => field.type === "number").map((field) => (
              <label key={field.key}>{field.label} weight
                <input type="number" value={formulaWeights[field.key] ?? 0} onChange={(event) => setFormulaWeights((current) => ({ ...current, [field.key]: event.target.valueAsNumber }))} />
              </label>
            ))}
            <button onClick={() => void saveFormula()}>Save formula</button>
          </section>
        </aside>
      </div>
    </main>
  );
}

function Field({
  field,
  value,
  onChange,
}: {
  field: SchemaDefinition["fields"][number];
  value: unknown;
  onChange(value: unknown): void;
}) {
  if (field.type === "boolean") {
    return <label className="check-field"><input type="checkbox" checked={Boolean(value)} onChange={(event) => onChange(event.target.checked)} />{field.label}</label>;
  }
  if (field.type === "select") {
    return <label>{field.label}<select value={String(value ?? "")} onChange={(event) => onChange(event.target.value)}><option value="">Select…</option>{field.options?.map((option) => <option key={option}>{option}</option>)}</select></label>;
  }
  return <label>{field.label}<input type={field.type === "number" ? "number" : "text"} value={String(value ?? "")} required={field.required} onChange={(event) => onChange(field.type === "number" ? event.target.valueAsNumber : event.target.value)} /></label>;
}
