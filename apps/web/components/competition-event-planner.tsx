"use client";

import { anySignal } from "../lib/abort/any-signal";
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { Button } from "./ui";
import { competitionDay, dateSchedule, plannedLastDay, validateCompetitionDraft, type PlannedCompetition } from "../lib/events/event-planning";
import { withOrgHref } from "../lib/nav/product-nav";
import { notifyTeamDataChanged } from "../lib/team-data-changed";
import "./competition-event-planner.css";

type Directory = { events: PlannedCompetition[]; canSetEvent: boolean; activeEventKey: string | null; publishedCount?: number };
type Scope = "all" | "offseason" | "saved";

function whenWhere(event: PlannedCompetition): string {
  const start = event.plannedStart ? competitionDay(event.plannedStart, event.timeZone) : event.startDate;
  const end = event.plannedEnd ? plannedLastDay(event.plannedEnd, event.timeZone) : event.endDate;
  const format = (day: string) => new Date(`${day}T12:00:00`).toLocaleDateString(undefined, { month: "short", day: "numeric" });
  return [[event.city, event.stateProv].filter(Boolean).join(", "), start ? `${format(start)}${end && end !== start ? `–${format(end)}` : ""}` : "Dates not announced"].filter(Boolean).join(" · ");
}

/** One directory and one save flow, used from Competition and Calendar. */
export function CompetitionEventPlanner({ orgId, initialEventKey, onChanged, onActive, onBusy }: {
  orgId: string;
  initialEventKey?: string | null;
  onChanged?: () => void;
  onActive?: (eventKey: string | null) => void;
  onBusy?: (busy: boolean) => void;
}) {
  const currentYear = new Date().getFullYear();
  const [year, setYear] = useState(initialEventKey ? Number(initialEventKey.slice(0, 4)) || currentYear : currentYear);
  const [query, setQuery] = useState("");
  const [scope, setScope] = useState<Scope>("all");
  const [directory, setDirectory] = useState<Directory | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [retry, setRetry] = useState(0);
  const [selected, setSelected] = useState<PlannedCompetition | null>(null);
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const saving = useRef(false);
  const initialSelectionDone = useRef(false);
  const generation = useRef(0);
  const attemptedYears = useRef(new Set<string>());
  const directoryRequest = useRef<AbortController | null>(null);
  const directoryEpoch = useRef(0);
  const [refreshingDirectory, setRefreshingDirectory] = useState(false);
  const [directoryMessage, setDirectoryMessage] = useState("");
  useEffect(() => {
    directoryEpoch.current++; setRefreshingDirectory(false); setDirectoryMessage("");
    return () => { directoryEpoch.current++; directoryRequest.current?.abort(); directoryRequest.current = null; };
  }, [orgId, year]);
  useEffect(() => {
    const epoch = ++generation.current;
    const controller = new AbortController();
    setLoading(true); setFailed(false);
    const timer = window.setTimeout(async () => {
      try {
        const params = new URLSearchParams({ orgId, year: String(year), q: query, scope });
        if (query.trim()) params.set("allSeasons", "1");
        const response = await fetch(`/api/context/event?${params}`, { signal: anySignal([controller.signal, AbortSignal.timeout(10000)]), cache: "no-store" });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error ?? "Couldn't load events. Try again.");
        if (epoch === generation.current) {
          setDirectory(data); setLoading(false);
          if (initialEventKey && !initialSelectionDone.current) {
            initialSelectionDone.current = true;
            setSelected(data.events.find((event: PlannedCompetition) => event.eventKey === initialEventKey) ?? null);
          }
        }
      } catch (error) {
        if (!controller.signal.aborted && epoch === generation.current) {
          setFailed(true); setLoading(false); setMessage(error instanceof Error ? error.message : "Couldn't load events. Try again.");
        }
      }
    }, query ? 180 : 0);
    return () => { controller.abort(); window.clearTimeout(timer); };
  }, [orgId, year, query, scope, retry, initialEventKey]);
  useEffect(() => () => { generation.current++; }, []);

  async function save(body: Record<string, unknown>) {
    if (saving.current) return;
    const epoch = generation.current;
    saving.current = true; setBusy(true); onBusy?.(true); setMessage("");
    try {
      // The post-save refresh advances the generation, so older search
      // responses cannot replace it. The same guard covers unmounts.
      const response = await fetch("/api/context/event", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ orgId, ...body }), signal: AbortSignal.timeout(20000) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "This event wasn't saved. Try again.");
      if (epoch !== generation.current) return;
      setMessage(body.intent === "activate" ? body.eventKey === null ? "No competition is active. Your saved events stay on the calendar." : `${data.eventName ?? "Event"} is active for the whole team.` : data.scheduled ? `${data.eventName} is on the team's calendar.` : `${data.eventName} is saved for preparation.`);
      setSelected(null); setAdding(false); setRetry(n => n + 1);
      onChanged?.();
      notifyTeamDataChanged({ orgId, kind: "event" });
      if (body.intent === "activate") onActive?.(data.eventKey ?? null);
    } catch (error) {
      if (epoch === generation.current) setMessage(error instanceof Error ? error.message : "Check your connection and try again.");
    } finally {
      saving.current = false;
      setBusy(false); onBusy?.(false);
    }
  }

  const refreshDirectory = useCallback(async () => {
    if (saving.current || directoryRequest.current) return;
    const controller = new AbortController(); directoryRequest.current = controller;
    setRefreshingDirectory(true); setDirectoryMessage("");
    const epoch = directoryEpoch.current;
    try {
      const response = await fetch("/api/context/event/directory", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ orgId, year }), signal: anySignal([controller.signal, AbortSignal.timeout(45000)]) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Published events couldn't be refreshed.");
      if (epoch !== directoryEpoch.current) return;
      setDirectoryMessage(
        data.pending
          ? "Finding published events. You can keep browsing or add your own."
          : data.count === 0
            ? `No ${year} events have been published yet. You can still add your own event.`
            : "Published events are up to date. Saved events are kept.",
      );
      // A team write has its own post-save refresh and generation guard.
      if (!saving.current) setRetry(n => n + 1);
    } catch (error) {
      if (!controller.signal.aborted && epoch === directoryEpoch.current) setDirectoryMessage(error instanceof Error ? error.message : "Couldn't refresh published events. Try again.");
    } finally { if (directoryRequest.current === controller) { directoryRequest.current = null; setRefreshingDirectory(false); } }
  }, [orgId, year]);

  // Opening an uncached season is the request to find its published events.
  // The server shares a six-hour cache and a refresh claim across users.
  useEffect(() => {
    const key = `${orgId}:${year}`;
    if (loading || failed || busy || query || scope !== "all" || !directory?.canSetEvent || directory.publishedCount !== 0 || attemptedYears.current.has(key)) return;
    attemptedYears.current.add(key);
    void refreshDirectory();
  }, [orgId, year, loading, failed, busy, query, scope, directory, refreshDirectory]);

  const canManage = directory?.canSetEvent === true;
  if (selected || adding) return <CompetitionEventDetails key={selected?.eventKey ?? `new:${year}`} year={selected?.year ?? year} event={selected} activeKey={directory?.activeEventKey ?? null} busy={busy} message={message} onBack={() => { if (!busy) { setSelected(null); setAdding(false); setMessage(""); } }} onSave={save} orgId={orgId} canManage={canManage} preferActivation={Boolean(onActive)} />;

  return <div className="competition-planner">
    <p className="competition-planner-intro">Find a competition, prepare in advance, or put it on the whole team&rsquo;s calendar.</p>
    <div className="competition-planner-search">
      <input type="search" aria-label="Search competitions" placeholder="Search all seasons: names, cities, or event keys" value={query} disabled={busy} onChange={e => { setQuery(e.target.value); setMessage(""); }} />
      <label><span>Browse season</span><input aria-label="Competition season" type="number" min="1992" max="2100" value={year} disabled={busy || Boolean(query.trim())} onChange={e => setYear(Number(e.target.value))} /></label>
    </div>
    <div className="competition-planner-scopes" role="group" aria-label="Competition directory">
      {(["all", "offseason", "saved"] as Scope[]).map(value => <button key={value} type="button" aria-pressed={scope === value} disabled={busy} onClick={() => { setScope(value); setMessage(""); }}>{value === "all" ? "All events" : value === "offseason" ? "Offseason" : "Saved"}</button>)}
    </div>
    {query.trim() ? <p className="competition-planner-note">Searching published and saved events across all cached seasons.</p> : null}
    {message ? <p role={failed ? "alert" : "status"} className="competition-planner-message">{message}</p> : null}
    {refreshingDirectory || directoryMessage ? <p role="status" className="competition-planner-note">{refreshingDirectory ? "Finding published events. You can keep browsing or add your own." : directoryMessage}</p> : null}
    {loading ? <p role="status">Finding events…</p> : failed ? <Button variant="secondary" type="button" onClick={() => setRetry(n => n + 1)}>Try again</Button> : directory?.events.length ? <ul className="competition-planner-list">
      {directory.events.map(event => <li key={event.eventKey}><button type="button" disabled={busy} onClick={() => { setSelected(event); setMessage(""); }}>
        <span><strong>{event.name}</strong><small>{event.year} · {whenWhere(event)}</small></span>
        <span className="competition-planner-badge">{event.eventKey === directory.activeEventKey ? "Active" : event.calendarId ? "On calendar" : event.custom || event.eventType === 99 || event.eventType === 100 ? "Offseason" : "View"}</span>
      </button></li>)}
    </ul> : <p>No matching {scope === "saved" ? "saved " : ""}events {query.trim() ? "in the saved directory" : `for ${year}`}. {canManage ? "Add an unlisted event below, including any offseason competition." : "Ask your scouting lead to add an unlisted event."}</p>}
    {canManage ? <div className="competition-planner-footer"><Button type="button" variant="secondary" disabled={busy} onClick={() => { setAdding(true); setMessage(""); }}>Add an unlisted event</Button><button className="text-button" type="button" disabled={busy || refreshingDirectory} onClick={() => void refreshDirectory()}>{refreshingDirectory ? "Finding published events…" : "Refresh published events"}</button></div> : !loading && !failed ? <p className="competition-planner-note">Everyone can prepare. A scouting lead sets the event and its team calendar dates.</p> : null}
  </div>;
}

function CompetitionEventDetails({ year, event, activeKey, busy, message, onBack, onSave, orgId, canManage, preferActivation }: {
  year: number; event: PlannedCompetition | null; activeKey: string | null; busy: boolean; message: string;
  onBack: () => void; onSave: (body: Record<string, unknown>) => Promise<void>; orgId: string; canManage: boolean; preferActivation: boolean;
}) {
  const [name, setName] = useState(event?.name ?? "");
  const [start, setStart] = useState(event?.plannedStart ? competitionDay(event.plannedStart, event.timeZone) : event?.startDate ?? "");
  const [end, setEnd] = useState(event?.plannedEnd ? plannedLastDay(event.plannedEnd, event.timeZone) : event?.endDate ?? "");
  const [timeZone, setTimeZone] = useState(event?.timeZone || Intl.DateTimeFormat().resolvedOptions().timeZone);
  const [city, setCity] = useState(event?.city ?? "");
  const [region, setRegion] = useState(event?.stateProv ?? "");
  const [calendar, setCalendar] = useState(true);
  const [autoActivate, setAutoActivate] = useState(event?.autoActivate ?? Boolean(start && start >= competitionDay(new Date().toISOString(), timeZone)));
  const [error, setError] = useState("");
  const identity = event?.catalogId ? { catalogId: event.catalogId } : event ? { eventKey: event.eventKey } : { create: { name: name.trim(), year, startDate: start || null, endDate: end || null, city: city.trim() || null, stateProv: region.trim() || null, timeZone } };
  const canSaveOnly = !event || Boolean(event.catalogId);
  function submit(e: FormEvent) {
    e.preventDefault(); setError("");
    try {
      if (!event) validateCompetitionDraft({ name, year, startDate: start || null, endDate: end || null });
      const schedule = calendar ? dateSchedule(start, end, autoActivate, timeZone) : undefined;
      void onSave({ ...identity, intent: calendar ? "schedule" : "save", schedule });
    } catch (problem) { setError(problem instanceof Error ? problem.message : "Check the event dates."); }
  }
  return <div className="competition-planner competition-planner-detail">
    <button className="text-button" type="button" disabled={busy} onClick={onBack}>Back to events</button>
    <h3>{event?.name ?? "Add an unlisted event"}</h3>
    {event?.sourceUrl ? <a href={event.sourceUrl} target="_blank" rel="noreferrer">Organizer details</a> : null}
    {event && !event.catalogId ? <a className="competition-planner-prepare" href={withOrgHref(`/competition?tab=scouting&eventKey=${encodeURIComponent(event.eventKey)}`, orgId)}>Prepare scouting for this event</a> : null}
    {!canManage ? <p>A scouting lead can add dates or make this event active for the team.</p> : <form onSubmit={submit}>
      <div className="competition-planner-fields">
      {!event ? <label>Event name<input value={name} required maxLength={80} placeholder="e.g. GRITS or your local scrimmage" disabled={busy} onChange={e => setName(e.target.value)} /></label> : null}
      <div className="competition-planner-dates">
        <label>First day<input type="date" value={start} required={calendar} disabled={busy} onChange={e => setStart(e.target.value)} /></label>
        <label>Last day<input type="date" value={end} min={start || undefined} disabled={busy} onChange={e => setEnd(e.target.value)} /></label>
      </div>
      <details><summary>Time zone</summary><label>Event time zone<input value={timeZone} disabled={busy} onChange={e => setTimeZone(e.target.value)} /></label></details>
      {!event ? <div className="competition-planner-dates"><label>City<input value={city} disabled={busy} onChange={e => setCity(e.target.value)} /></label><label>State or region<input value={region} disabled={busy} onChange={e => setRegion(e.target.value)} /></label></div> : null}
      {canSaveOnly ? <label className="competition-planner-check"><input type="checkbox" checked={calendar} disabled={busy} onChange={e => setCalendar(e.target.checked)} /><span>Add to the whole team&rsquo;s calendar</span></label> : <p>These dates are shared with the whole team.</p>}
      {calendar ? <><label className="competition-planner-check"><input type="checkbox" checked={autoActivate} disabled={busy} onChange={e => setAutoActivate(e.target.checked)} /><span>Make active automatically on the first day</span></label><p className="competition-planner-note">When someone opens Vantage that day, scouting, matches and strategy follow this event for everyone. A later manual selection takes priority.</p></> : <p className="competition-planner-note">Saved and searchable for preparation. Your team&rsquo;s active event stays the same.</p>}
      {error || message ? <p role="alert" className="competition-planner-message">{error || message}</p> : null}
      </div>
      <div className="competition-planner-actions">
        {event && !event.catalogId && event.eventKey !== activeKey ? <Button type="button" variant={preferActivation ? "primary" : "secondary"} disabled={busy} onClick={() => void onSave({ eventKey: event.eventKey, intent: "activate" })}>Make active now</Button> : null}
        <Button type="submit" variant={preferActivation && event && !event.catalogId && event.eventKey !== activeKey ? "secondary" : "primary"} disabled={busy || (!event && !name.trim())}>{busy ? "Saving…" : calendar ? event?.calendarId ? "Save calendar dates" : "Add to team calendar" : "Save event"}</Button>
        {event?.eventKey === activeKey ? <button type="button" className="text-button" disabled={busy} onClick={() => void onSave({ eventKey: null, intent: "activate" })}>Stop following this event</button> : null}
      </div>
    </form>}
  </div>;
}
