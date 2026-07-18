"use client";

import type { SchemaDefinition, ScoutSchema, SyncEntry } from "@vantage/scouting";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { EmptyState, FormRow, PageHeader, Panel, TabBar } from "../../components/ui";
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

type ScoutTab = "match" | "pit" | "conflicts";

type OfficialFlag = {
  fieldKey: string;
  status: string;
  scoutValue: unknown;
  officialValue: unknown;
  officialSource: string;
  detail: string;
  soft?: boolean;
};

export default function ScoutingClient({ orgId }: { orgId: string }) {
  const searchParams = useSearchParams();
  const [data, setData] = useState<Bootstrap | null>(null);
  const [tab, setTab] = useState<ScoutTab>("match");
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
  const [officialFlags, setOfficialFlags] = useState<OfficialFlag[]>([]);
  const [formulaName, setFormulaName] = useState("");
  const [formulaWeights, setFormulaWeights] = useState<Record<string, number>>({});
  const [showFormula, setShowFormula] = useState(false);

  const type = tab === "pit" ? "pit" : "match";

  const refreshCounts = useCallback(async () => setCounts(await pendingCounts()), []);
  const sync = useCallback(async () => {
    if (!orgId || !navigator.onLine) return;
    try {
      const entries = await syncOutbox(orgId);
      const media = await syncMediaOutbox(orgId);
      if (entries.validations.length) setOfficialFlags(entries.validations);
      if (entries.count || media) {
        const conflictCount = entries.validations.filter((flag) => flag.status === "conflict").length;
        setMessage(
          conflictCount
            ? `Synced ${entries.count} entries · ${conflictCount} TBA contradiction${conflictCount === 1 ? "" : "s"} flagged`
            : `Synced ${entries.count} entries and ${media} media files`,
        );
      }
      await refreshCounts();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Sync paused");
    }
  }, [orgId, refreshCounts]);

  const flagsByField = useMemo(() => {
    const map = new Map<string, OfficialFlag[]>();
    for (const flag of officialFlags) {
      const list = map.get(flag.fieldKey) ?? [];
      list.push(flag);
      map.set(flag.fieldKey, list);
    }
    return map;
  }, [officialFlags]);

  const liveConflicts = useMemo(
    () => officialFlags.filter((flag) => flag.status === "conflict" || (flag.soft && flag.detail)),
    [officialFlags],
  );

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
      for (const key of teams) {
        options.push({
          matchKey: match.matchKey,
          teamKey: key,
          label: `${comp} ${match.matchNumber} · ${key}`,
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
    const body = (await response.json().catch(() => ({}))) as Bootstrap & { error?: string };
    if (!response.ok) {
      setMessage(body.error ?? "Could not create starter forms.");
      return;
    }
    setData(body);
    await cacheEvent(orgId, body);
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

  function onTabChange(id: string) {
    const next = id as ScoutTab;
    setTab(next);
    if (next === "conflicts") void loadConflicts();
  }

  return (
    <main className="module-page scout-page">
      <PageHeader
        breadcrumbs="Competition / Scouting"
        title="Scouting Hub"
        description="Match and pit forms cache on this device. Coverage stays empty until an active event and schema exist — nothing is fabricated."
      >
        <div className="scout-header-meta">
          <span className={`scout-sync-pill ${online ? "online" : "offline"}`}>
            {online ? "Online" : "Offline"} · {counts.entries} entries · {counts.media} media
          </span>
          <button type="button" className="app-button secondary" onClick={() => void sync()}>
            Sync now
          </button>
        </div>
      </PageHeader>

      <nav className="scout-related" aria-label="Related data tools" style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 16 }}>
        <a className="app-button secondary" href={`/scouting/lineup?orgId=${encodeURIComponent(orgId)}`}>
          Lineup &amp; coverage
        </a>
        <a
          className="app-button secondary"
          href={`/exports?orgId=${encodeURIComponent(orgId)}&domains=scouting-match,scouting-pit,scouting-disagreements${data?.eventKey ? `&eventKey=${encodeURIComponent(data.eventKey)}` : ""}`}
        >
          Export scout CSVs
        </a>
        <a className="app-button secondary" href={`/team/data?orgId=${encodeURIComponent(orgId)}`}>
          Data analytics
        </a>
      </nav>

      {!data?.eventKey ? (
        <EmptyState
          badge="Setup required"
          badgeTone="setup"
          title="No active event"
          description="Select an event in Event Day before assignments and forms can load. Offline queue still works once an event is cached."
        >
          <a className="app-button secondary" href={`/command?orgId=${encodeURIComponent(orgId)}`}>
            Select event
          </a>
        </EmptyState>
      ) : null}

      {data?.eventKey && !schema && tab !== "conflicts" ? (
        <EmptyState
          badge="Forms required"
          badgeTone="setup"
          title={`No ${type} scouting form yet`}
          description={
            data.canManageSchemas
              ? "Create starter match and pit forms for this season, or publish a custom schema from Team settings."
              : "Ask an owner or admin to publish scouting forms for this event."
          }
        >
          {data.canManageSchemas ? (
            <button className="app-button secondary" type="button" onClick={() => void createStarterForms()}>
              Create starter forms
            </button>
          ) : null}
        </EmptyState>
      ) : null}

      {data?.eventKey ? (
        <Panel className="scout-event-strip" style={{ minHeight: "auto", marginBottom: 14 }}>
          <strong>{data.eventKey}</strong>
          <span className="app-muted">Forms and assignments are cached on this device.</span>
        </Panel>
      ) : null}

      <TabBar
        aria-label="Scouting views"
        value={tab}
        onChange={onTabChange}
        tabs={[
          { id: "match", label: "Match" },
          { id: "pit", label: "Pit" },
          { id: "conflicts", label: "Conflicts" },
        ]}
      />

      {tab === "conflicts" ? (
        <Panel>
          <h2 style={{ marginTop: 0 }}>Cross-scout disagreements</h2>
          {conflicts.length === 0 ? (
            <p className="app-muted">
              No open disagreements for this event. Load again after scouts submit overlapping fields.
            </p>
          ) : (
            <ul className="scout-conflict-list">
              {conflicts.map((conflict) => (
                <li key={String(conflict.id)}>
                  <strong>
                    {String(conflict.matchKey)} · {String(conflict.teamKey)}
                  </strong>
                  <span>
                    {String(conflict.fieldKey)}: {JSON.stringify(conflict.values)}
                  </span>
                  <small className="app-muted">
                    Status: {String(conflict.status)} · entry attribution retained
                  </small>
                  {conflict.status === "open" ? (
                    <div className="scout-conflict-actions">
                      <button
                        type="button"
                        className="app-button secondary"
                        onClick={() => void reviewConflict(String(conflict.id), "resolved")}
                      >
                        Resolve
                      </button>
                      <button
                        type="button"
                        className="app-button secondary"
                        onClick={() => void reviewConflict(String(conflict.id), "dismissed")}
                      >
                        Dismiss
                      </button>
                    </div>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </Panel>
      ) : (
        <div className="scout-workbench">
          <Panel as="section" className="scout-form-panel">
            <header className="scout-form-heading">
              <div>
                <h2>{schema?.definition.title ?? `No ${type} form`}</h2>
                <p className="app-muted">Primary action: fill the form, then save.</p>
              </div>
              <span className="app-badge">v{schema?.version ?? "—"}</span>
            </header>

            {type === "match" ? (
              <FormRow
                label="Assignment"
                hint={
                  !matchOptions.length
                    ? "No assignments or synced matches yet — sync TBA after the schedule is published."
                    : undefined
                }
              >
                <select
                  value={`${matchKey}|${teamKey}`}
                  onChange={(event) => {
                    const [match, team] = event.target.value.split("|");
                    setMatchKey(match ?? "");
                    setTeamKey(team ?? "");
                  }}
                >
                  <option value="|">Select match and team</option>
                  {matchOptions.map((option) => (
                    <option key={`${option.matchKey}-${option.teamKey}`} value={`${option.matchKey}|${option.teamKey}`}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </FormRow>
            ) : (
              <FormRow label="Team key">
                <input
                  value={teamKey}
                  onChange={(event) => setTeamKey(event.target.value)}
                  placeholder="frc254"
                />
              </FormRow>
            )}

            {liveConflicts.length ? (
              <div className="scout-official-flags" role="status">
                <strong>Live official checks</strong>
                <ul>
                  {liveConflicts.map((flag) => (
                    <li
                      key={`${flag.fieldKey}-${flag.officialSource}-${flag.status}`}
                      data-status={flag.status}
                      data-soft={flag.soft ? "true" : "false"}
                    >
                      <b>{flag.fieldKey}</b>
                      <span>{flag.detail}</span>
                      {flag.status === "conflict" ? (
                        <small>
                          Scout {JSON.stringify(flag.scoutValue)} · Official {JSON.stringify(flag.officialValue)}
                        </small>
                      ) : null}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}

            {schema?.definition.fields.map((field) => (
              <Field
                key={field.key}
                field={field}
                value={payload[field.key]}
                flags={flagsByField.get(field.key) ?? []}
                onChange={(value) => setPayload((current) => ({ ...current, [field.key]: value }))}
              />
            ))}

            <FormRow label="Scout confidence">
              <select
                value={confidence}
                onChange={(event) => setConfidence(event.target.value as typeof confidence)}
              >
                <option value="high">High</option>
                <option value="normal">Normal</option>
                <option value="low">Low — downweighted</option>
              </select>
            </FormRow>

            <div className="scout-voice">
              <div>
                <strong>Voice draft</strong>
                <small className="app-muted">Stays a draft until you confirm and save.</small>
              </div>
              <button type="button" className="app-button secondary" onClick={startVoiceDraft}>
                Record
              </button>
              <textarea
                value={voiceDraft}
                onChange={(event) => {
                  const transcript = event.target.value;
                  setVoiceDraft(transcript);
                  setSource("voice");
                  const draftField = schema?.definition.fields.find((field) => field.type === "text");
                  if (draftField) setPayload((current) => ({ ...current, [draftField.key]: transcript }));
                }}
                placeholder="Voice notes (copied into the first text field)…"
              />
            </div>

            {type === "pit" ? (
              <label className="scout-media">
                Queue pit photo/video
                <input
                  type="file"
                  accept="image/*,video/*"
                  onChange={(event) => event.target.files?.[0] && void attachMedia(event.target.files[0])}
                />
              </label>
            ) : null}

            <button type="button" className="app-button" onClick={() => void submit()}>
              Save {online ? "& sync" : "offline"}
            </button>
            {message ? (
              <p className="form-message" role="status">
                {message}
              </p>
            ) : null}
          </Panel>

          <aside className="scout-side">
            <Panel className="scout-activity" style={{ minHeight: "auto" }}>
              <h2 style={{ marginTop: 0 }}>Recent entries</h2>
              <p className="app-muted">
                Latest timestamp wins per entry. Scout identity, confidence, and source stay visible.
              </p>
              {data?.recentEntries?.length ? (
                <ul className="scout-entry-list">
                  {data.recentEntries.map((entry) => (
                    <li key={entry.id}>
                      <strong>
                        {entry.matchKey ?? "PIT"} · {entry.teamKey}
                      </strong>
                      <span>
                        {entry.scoutName} · {entry.source}
                      </span>
                      <small className="app-muted">
                        {entry.confidence} confidence · {new Date(entry.updatedAt).toLocaleTimeString()}
                      </small>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="app-muted">No entries yet for this event.</p>
              )}
            </Panel>

            <Panel style={{ minHeight: "auto" }}>
              <button
                type="button"
                className="text-button"
                onClick={() => setShowFormula((open) => !open)}
              >
                {showFormula ? "Hide coach formula" : "Coach value formula"}
              </button>
              {showFormula ? (
                <div className="scout-formula">
                  <p className="app-muted">Optional weighted score from numeric fields. Coach role required to save.</p>
                  <FormRow label="Formula name">
                    <input
                      aria-label="Formula name"
                      placeholder="e.g. Pick value"
                      value={formulaName}
                      onChange={(event) => setFormulaName(event.target.value)}
                    />
                  </FormRow>
                  {schema?.definition.fields
                    .filter((field) => field.type === "number")
                    .map((field) => (
                      <FormRow key={field.key} label={`${field.label} weight`}>
                        <input
                          type="number"
                          value={formulaWeights[field.key] ?? 0}
                          onChange={(event) =>
                            setFormulaWeights((current) => ({
                              ...current,
                              [field.key]: event.target.valueAsNumber,
                            }))
                          }
                        />
                      </FormRow>
                    ))}
                  <button type="button" className="app-button secondary" onClick={() => void saveFormula()}>
                    Save formula
                  </button>
                </div>
              ) : null}
            </Panel>
          </aside>
        </div>
      )}
    </main>
  );
}

function Field({
  field,
  value,
  flags,
  onChange,
}: {
  field: SchemaDefinition["fields"][number];
  value: unknown;
  flags: OfficialFlag[];
  onChange(value: unknown): void;
}) {
  const conflict = flags.find((flag) => flag.status === "conflict");
  const soft = flags.find((flag) => flag.soft);
  const hint = conflict?.detail ?? soft?.detail;
  const tone = conflict ? "conflict" : soft ? "soft" : flags.some((flag) => flag.status === "match") ? "match" : undefined;
  const body = (() => {
    if (field.type === "boolean") {
      return (
        <label className="soft-form-row check-field">
          <span className="app-muted">{field.label}</span>
          <input type="checkbox" checked={Boolean(value)} onChange={(event) => onChange(event.target.checked)} />
        </label>
      );
    }
    if (field.type === "select") {
      return (
        <FormRow label={field.label}>
          <select value={String(value ?? "")} onChange={(event) => onChange(event.target.value)}>
            <option value="">Select…</option>
            {field.options?.map((option) => (
              <option key={option}>{option}</option>
            ))}
          </select>
        </FormRow>
      );
    }
    return (
      <FormRow label={field.label}>
        <input
          type={field.type === "number" ? "number" : "text"}
          value={String(value ?? "")}
          required={field.required}
          onChange={(event) =>
            onChange(field.type === "number" ? event.target.valueAsNumber : event.target.value)
          }
        />
      </FormRow>
    );
  })();
  return (
    <div className={`scout-field-wrap${tone ? ` is-${tone}` : ""}`}>
      {body}
      {hint ? (
        <p className={`scout-field-flag ${tone ?? ""}`} role="status">
          {hint}
        </p>
      ) : null}
    </div>
  );
}
