"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { z } from "zod";
import { EmptyState, Panel, Button, FormRow, TabBar, SoftBlockSkeleton } from "../../components/ui";
import { scoutEventLabel } from "../../lib/scouting/scouting-related";
import { classifyLoadFailure, loadFailureCopy } from "../../lib/ui/load-failure";
import { FEATURE_API_TIMEOUT_MS } from "../../lib/nav/resolve-org";
import { withOrgHref } from "../../lib/nav/product-nav";
import ScoutingReconciliationPanel from "./scouting-reconciliation-panel";
import { qualityEvidenceSchema } from "../../lib/scouting/quality-evidence";
import { QualityQuestionChecks } from "./quality-question-checks";

const count = z.number().int().nonnegative();
const trustView = qualityEvidenceSchema.extend({
  generatedAt: z.string(), canManage: z.boolean(),
  schemaBudgets: z.array(z.object({ schemaId: z.string().uuid(), year: count, type: z.enum(["match", "pit"]), title: z.string(), version: count,
    fieldCount: count, recommendedMaximum: count, status: z.string(), message: z.string(),
    fields: z.array(z.object({ key: z.string(), label: z.string(), comparable: z.boolean(), comparisonMessage: z.string().optional() })) })),
  policies: z.array(z.object({ schemaId: z.string().uuid(), fieldKey: z.string(), preferredSource: z.string(), officialKey: z.string().nullable(),
    teamIndexed: z.boolean(), enabled: z.boolean(), updatedAt: z.string() })),
  sourceHealth: z.array(z.object({ source: z.string(), status: z.string() })),
  myInfluence: z.array(z.object({ entryId: z.string().uuid(), teamKey: z.string(), reason: z.string(), recordedAt: z.string(), matchKey: z.string().nullable(),
    pickListName: z.string().nullable(), teamNumber: z.number().nullable(), nickname: z.string().nullable() })),
  strategySeats: z.array(z.object({ userId: z.string().uuid(), name: z.string(), meetingOn: z.string(), reason: z.string() })),
});
type TrustView = z.infer<typeof trustView>;
export type QualitySection = "checks" | "scouts" | "alliance" | "impact" | "rules";
type Command =
  | { action: "set-policy"; schemaId: string; fieldKey: string; enabled: boolean; expectedUpdatedAt: string | null; preferredSource: string; officialKey: string | null; teamIndexed: boolean }
  | { action: "seat-top-accurate"; meetingOn: string; seatCount: number };
const percent = (value: number | null) => value == null ? "No checks" : `${Math.round(value * 100)}%`;

export default function ScoutingTrustPanel({ orgId, eventKey, initialSection = "checks" }: {
  orgId: string; eventKey: string | null; initialSection?: QualitySection;
}) {
  const [storedView, setView] = useState<TrustView | null>(null);
  const view = storedView && storedView.orgId === orgId && (!eventKey || storedView.eventKey === eventKey) ? storedView : null;
  const [message, setMessage] = useState("");
  const [status, setStatus] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [stale, setStale] = useState(false);
  const [section, setSection] = useState<QualitySection>(initialSection);
  const [meetingOn, setMeetingOn] = useState("");
  const [seatCount, setSeatCount] = useState("3");
  const generation = useRef(0);
  const mounted = useRef(true);
  const writing = useRef(false);
  const reading = useRef(false);
  const writable = useRef(false);
  const abort = useRef<AbortController | null>(null);
  const current = useRef(view);
  current.current = view;
  const scoped = useCallback((value: unknown) => {
    const parsed = trustView.safeParse(value);
    return parsed.success && parsed.data.orgId === orgId && (!eventKey || parsed.data.eventKey === eventKey) ? parsed.data : null;
  }, [eventKey, orgId]);
  const load = useCallback(async () => {
    if (writing.current) return;
    abort.current?.abort();
    const controller = new AbortController(); abort.current = controller;
    const id = ++generation.current;
    reading.current = true; writable.current = false;
    setRefreshing(true); setMessage(""); setStatus(null);
    const params = new URLSearchParams({ orgId });
    if (eventKey) params.set("eventKey", eventKey);
    try {
      const response = await fetch(`/api/scouting/trust?${params}`, { cache: "no-store", signal: AbortSignal.any([controller.signal, AbortSignal.timeout(FEATURE_API_TIMEOUT_MS)]) });
      const data: unknown = await response.json().catch(() => null);
      if (!mounted.current || id !== generation.current) return;
      if (!response.ok) {
        setStatus(response.status);
        if (response.status === 401 || response.status === 403) { current.current = null; setView(null); }
        throw new Error(data && typeof data === "object" && "error" in data && typeof data.error === "string" ? data.error : "Could not refresh scouting quality.");
      }
      const next = scoped(data);
      if (!next) throw new Error("The quality result did not match this team and event. Refresh to try again.");
      current.current = next; setView(next); setStale(false); setStatus(null); writable.current = true;
    } catch (error) {
      if (mounted.current && id === generation.current) { setStale(true); setMessage(error instanceof Error ? error.message : "Quality checks could not load. Refresh to try again."); }
    } finally { if (mounted.current && id === generation.current) { reading.current = false; setRefreshing(false); } }
  }, [eventKey, orgId, scoped]);
  useEffect(() => { mounted.current = true; void load(); return () => { mounted.current = false; ++generation.current; abort.current?.abort(); }; }, [load]);
  useEffect(() => setSection(initialSection), [initialSection]);

  const mutate = useCallback(async (command: Command) => {
    const before = current.current;
    if (!before?.canManage || !writable.current || reading.current || writing.current) return;
    writing.current = true; writable.current = false;
    const id = ++generation.current;
    setBusy(true); setMessage("");
    try {
      const response = await fetch("/api/scouting/trust", { method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...command, orgId, eventKey: before.eventKey }), signal: AbortSignal.timeout(FEATURE_API_TIMEOUT_MS) });
      const data: unknown = await response.json().catch(() => null);
      if (!mounted.current || id !== generation.current) return;
      if (!response.ok) {
        setStatus(response.status);
        if (response.status === 401 || response.status === 403) { current.current = null; setView(null); }
        throw new Error(data && typeof data === "object" && "error" in data && typeof data.error === "string" ? data.error : "Could not confirm this change. Refresh before retrying.");
      }
      const next = scoped(data);
      const result = data && typeof data === "object" && "trustResult" in data ? data.trustResult : null;
      if (!next || next.eventKey !== before.eventKey || !result || typeof result !== "object" || !("action" in result) || result.action !== command.action) throw new Error("The saved result could not be confirmed. Refresh before retrying.");
      if (command.action === "set-policy") {
        const saved = next.policies.find(row => row.schemaId === command.schemaId && row.fieldKey === command.fieldKey);
        if (!("schemaId" in result) || !("fieldKey" in result) || !("enabled" in result) || result.schemaId !== command.schemaId || result.fieldKey !== command.fieldKey || result.enabled !== command.enabled || saved?.enabled !== command.enabled) throw new Error("The source rule could not be confirmed. Refresh before retrying.");
        setMessage(command.enabled ? "Official checking enabled for this question. New and corrected reports use this rule." : "Official checking disabled for this question. Previous checks remain stored and are excluded from confidence.");
      } else {
        if (!("meetingOn" in result) || result.meetingOn !== command.meetingOn || !("userIds" in result) || !Array.isArray(result.userIds) || !result.userIds.every(userId => typeof userId === "string" && next.strategySeats.some(seat => seat.userId === userId && seat.meetingOn === command.meetingOn))) throw new Error("Meeting seats could not be confirmed. Refresh before retrying.");
        setMessage(result.userIds.length ? `${result.userIds.length} scouts confirmed for ${command.meetingOn}. Existing meeting seats are kept.` : "No current scout has enough official checks for this selection. No seats were added.");
      }
      current.current = next; setView(next); setStale(false); setStatus(null); writable.current = true;
    } catch (error) { if (mounted.current && id === generation.current) { setStale(true); setMessage(error instanceof Error ? error.message : "This change may have reached the server. Refresh before retrying."); } }
    finally { writing.current = false; if (mounted.current && id === generation.current) setBusy(false); }
  }, [orgId, scoped]);

  const disabled = busy || refreshing || stale;
  const failure = loadFailureCopy(classifyLoadFailure({ status, message, online: typeof navigator === "undefined" ? true : navigator.onLine }), { message, nextPath: typeof window === "undefined" ? null : `${window.location.pathname}${window.location.search}` });
  if (!view) return <Panel>{refreshing || !message ? <SoftBlockSkeleton lines={4} /> : <EmptyState title={failure.title} description={failure.description} badge={failure.badge}>
    {failure.primary ? <Button as="a" variant="primary" href={failure.primary.href}>{failure.primary.label}</Button> : null}
    {failure.showRetry ? <Button type="button" variant="secondary" onClick={() => void load()}>Refresh</Button> : null}
  </EmptyState>}</Panel>;
  if (!view.eventKey) return <EmptyState title="Choose an event" description="Official checks, scout consistency and alliance review use one event's reports."><Button as="a" variant="primary" href={withOrgHref("/competition?tab=command", orgId)}>Choose event</Button></EmptyState>;
  const active = section === "rules" && !view.canManage ? "checks" : section;
  const tabs = [{ id: "checks", label: "Official checks" }, { id: "scouts", label: "Scouts" }, { id: "alliance", label: "Alliance review" }, { id: "impact", label: "Your impact" }, ...(view.canManage ? [{ id: "rules", label: "Form checks" }] : [])];
  const degraded = view.sourceHealth.filter(source => source.status !== "healthy");
  const checks = view.fieldTrust.reduce((sum, row) => sum + row.checks, 0);
  const conflicts = view.fieldTrust.reduce((sum, row) => sum + row.conflicts, 0);
  const questionChecks = view.fieldTrustBySchema ?? view.fieldTrust.map(row => ({ ...row, schemaId: null,
    label: row.fieldKey, formTitle: null, year: null, version: null }));
  return <div className="scout-trust">
    <div className="scout-quality-toolbar"><div><strong>{scoutEventLabel({ eventKey: view.eventKey }) ?? "Selected event"}</strong><p className="app-muted">Robot-level official checks; alliance point totals do not grade an individual scout.</p></div>{active !== "alliance" ? <Button type="button" variant="secondary" disabled={busy || refreshing} onClick={() => void load()}>{refreshing ? "Refreshing…" : "Refresh"}</Button> : null}</div>
    {message ? <p className="form-message" role="status">{message}</p> : null}
    {stale ? <p className="app-muted">This view is read-only until a refresh confirms the current team data.</p> : null}
    {degraded.length ? <p className="scout-degraded" role="status">Reference data needs attention: {degraded.map(source => `${source.source}: ${source.status}`).join(" · ")}. Checks use the stored observations shown below.</p> : null}
    <TabBar className="scout-quality-tabs" panelId="scout-quality-content" aria-label="Scouting quality view" tabs={tabs} value={active} onChange={id => {
      setSection(id as QualitySection);
      const url = new URL(window.location.href); url.searchParams.set("section", id);
      window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
    }} />
    <div id="scout-quality-content" role="tabpanel" aria-labelledby={`scout-quality-content-tab-${active}`} tabIndex={0}>
    {active === "checks" ? <>
      <section className="scout-trust-kpis"><article><span>Official field checks</span><strong>{checks}</strong><small>Observed, comparable fields only</small></article><article><span>Checks needing review</span><strong>{conflicts}</strong><small>{checks ? `${percent(conflicts / checks)} of checks` : "No checks yet"}</small></article><article><span>Scouts with checks</span><strong>{view.leaderboard.filter(row => row.checks > 0).length}</strong><small>of {view.leaderboard.length} scouts with reports</small></article></section>
      <Panel><h2>Checks by question</h2><p className="app-muted">Only checks from the current evaluator count. Earlier checks, missing official values and unsupported comparisons are excluded. A correction that changes an older report checks it again. Each question keeps its original form and version. A conflict calls for reviewing the observation.</p><QualityQuestionChecks key={`${orgId}:${view.eventKey}`} questions={questionChecks} /></Panel>
    </> : null}
    {active === "scouts" ? <>
      <Panel><h2>Scout consistency</h2><p className="app-muted">Agreement among comparable official fields, with sample sizes beside each scout. Unchecked reports do not lower agreement.</p><ol className="accuracy-list">{view.leaderboard.map(scout => <li key={scout.userId}><b>{scout.name}</b><span>{scout.entries} reports · {scout.checks} field checks · {scout.conflicts} conflicts</span><strong>{percent(scout.accuracy)}</strong></li>)}</ol>{!view.leaderboard.length ? <p className="app-muted">No reports for this event yet.</p> : null}</Panel>
      <Panel><h2>Strategy meeting seats</h2><p className="app-muted">Include current scouts with at least three official checks in the pick-desk discussion. This adds the selected scouts and keeps existing meeting seats.</p><ol className="accuracy-list">{view.strategySeats.map(seat => <li key={`${seat.userId}:${seat.meetingOn}`}><b>{seat.name}</b><span>{seat.meetingOn}</span><strong>{seat.reason}</strong></li>)}</ol>{!view.strategySeats.length ? <p className="app-muted">No meeting seats saved for this event.</p> : null}{view.canManage ? <form className="scout-quality-seat-form" onSubmit={event => { event.preventDefault(); if (!disabled && meetingOn && Number.isInteger(Number(seatCount))) void mutate({ action: "seat-top-accurate", meetingOn, seatCount: Number(seatCount) }); }}><FormRow label="Meeting date"><input type="date" required value={meetingOn} disabled={disabled} onChange={event => setMeetingOn(event.target.value)} /></FormRow><FormRow label="Scouts to include"><input type="number" min={1} max={10} required value={seatCount} disabled={disabled} onChange={event => setSeatCount(event.target.value)} /></FormRow><Button type="submit" variant="primary" disabled={disabled || !meetingOn}>{busy ? "Saving…" : "Include scouts"}</Button></form> : null}</Panel>
    </> : null}
    {active === "alliance" ? <ScoutingReconciliationPanel key={`${orgId}:${view.eventKey}`} orgId={orgId} eventKey={view.eventKey} /> : null}
    {active === "impact" ? <Panel><h2>Where your scouting went</h2>{view.myInfluence.map(item => <article className="impact-row" key={`${item.entryId}:${item.recordedAt}`}><strong>{item.matchKey ? `${item.matchKey} · ` : ""}Team {item.teamNumber ?? item.teamKey.replace(/^frc/i, "")}</strong><p>{item.reason}</p><small className="app-muted">{item.pickListName ? `${item.pickListName} · ` : ""}{new Date(item.recordedAt).toLocaleString()}</small></article>)}{!view.myInfluence.length ? <p className="app-muted">Saved pick lists show the reports you contributed and why those teams were selected.</p> : null}<Button as="a" variant="secondary" href={withOrgHref(`/competition?tab=picks&eventKey=${encodeURIComponent(view.eventKey)}`, orgId)}>Open pick list</Button></Panel> : null}
    {active === "rules" ? <Panel><h2>Official checks for your forms</h2><p className="app-muted">Only robot-attributed official fields can check an individual report. New and corrected reports use these rules; disabling a rule excludes its old checks from confidence.</p>{view.schemaBudgets.map(schema => <details className="scout-quality-form-checks" key={schema.schemaId}><summary>{schema.title} · {schema.year} · {schema.type} · version {schema.version}</summary><p className="app-muted">{schema.message}</p>{schema.fields.map(field => { const policy = view.policies.find(row => row.schemaId === schema.schemaId && row.fieldKey === field.key); const enabled = policy?.enabled !== false; return <div className="scout-quality-rule" key={field.key}><div><strong>{field.label}</strong><small className="app-muted">{field.comparable ? enabled ? "Checking enabled" : "Checking disabled" : "Scout observation; no robot-level official comparison"}</small>{field.comparisonMessage ? <small className="app-muted">{field.comparisonMessage}</small> : null}</div>{field.comparable ? <Button type="button" variant="secondary" disabled={disabled} aria-label={`${enabled ? "Stop" : "Enable"} official checking: ${field.label}`} onClick={() => void mutate({ action: "set-policy", schemaId: schema.schemaId, fieldKey: field.key, enabled: !enabled, expectedUpdatedAt: policy?.updatedAt ?? null, preferredSource: policy?.preferredSource ?? "consensus", officialKey: policy?.officialKey ?? null, teamIndexed: policy?.teamIndexed ?? false })}>{enabled ? "Stop checking" : "Enable checking"}</Button> : null}</div>; })}</details>)}<Button as="a" variant="secondary" href={withOrgHref("/scouting/forms", orgId)}>Edit forms</Button></Panel> : null}
    </div>
  </div>;
}
