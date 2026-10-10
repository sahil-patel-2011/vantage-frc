"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Button, EmptyState, FormRow } from "../../components/ui";
import { FEATURE_API_TIMEOUT_MS } from "../../lib/nav/resolve-org";
import { apiErrorMessage, classifyLoadFailure, loadFailureCopy } from "../../lib/ui/load-failure";
import { labelForMatchKey } from "../../lib/scouting/next-match";
import { scoutEntryByline } from "../../lib/scouting/scout-report";
import { qualityAnswerLabel, qualityReportUrl, readQualityReportPage, type QualityReportCursor, type QualityReportPage, type QualityReportScope } from "../../lib/scouting/quality-reports";

type Scope = Omit<QualityReportScope, "status">;
export function QualityQuestionReports({ scope, hasConflicts, active }: { scope: Scope; hasConflicts: boolean; active: boolean }) {
  const [status, setStatus] = useState<QualityReportScope["status"]>(hasConflicts ? "conflict" : "all");
  return <div className="scout-quality-reports">
    <FormRow label="Show reports"><select value={status} onChange={event => setStatus(event.target.value as QualityReportScope["status"])}>
      <option value="conflict">Checks needing review</option><option value="all">All comparable checks</option>
    </select></FormRow>
    <ReportList key={status} {...scope} status={status} active={active} />
  </div>;
}

function ReportList({ orgId, eventKey, schemaId, fieldKey, status, active }: QualityReportScope & { active: boolean }) {
  const [reports, setReports] = useState<QualityReportPage["reports"]>([]);
  const [next, setNext] = useState<QualityReportCursor | null>(null);
  const [loading, setLoading] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [enabled, setEnabled] = useState(true);
  const [error, setError] = useState<{ status: number | null; message: string } | null>(null);
  const [stale, setStale] = useState(false);
  const mounted = useRef(true);
  const reading = useRef(false);
  const generation = useRef(0);
  const abort = useRef<AbortController | null>(null);
  const load = useCallback(async (cursor: QualityReportCursor | null) => {
    if (reading.current || !mounted.current) return;
    reading.current = true;
    const id = ++generation.current;
    const controller = new AbortController(); abort.current = controller;
    setLoading(true); setError(null);
    let failureStatus: number | null = null;
    const current = () => mounted.current && id === generation.current;
    try {
      const scope = { orgId, eventKey, schemaId, fieldKey, status };
      const response = await fetch(qualityReportUrl(scope, cursor), { cache: "no-store",
        signal: AbortSignal.any([controller.signal, AbortSignal.timeout(FEATURE_API_TIMEOUT_MS)]) });
      if (!current()) return;
      if (!response.ok) {
        failureStatus = response.status;
        if ([401, 403, 404, 422].includes(response.status)) { setReports([]); setNext(null); setConfirmed(false); }
        throw new Error(await apiErrorMessage(response) ?? "Report checks could not load. Refresh to try again.");
      }
      const page = readQualityReportPage(await response.json().catch(() => null), scope);
      if (!current()) return;
      if (!page || cursor && page.nextCursor && page.nextCursor.validationId === cursor.validationId && page.nextCursor.checkedAt === cursor.checkedAt) throw new Error("The report result did not match this question. Refresh before continuing.");
      setReports(previous => !page.checkingEnabled ? [] : cursor ? [...new Map([...previous, ...page.reports].map(report => [report.validationId, report])).values()] : page.reports);
      setNext(page.nextCursor); setEnabled(page.checkingEnabled); setConfirmed(true); setStale(false);
    } catch (failure) {
      if (current()) { setStale(true); setError({ status: failureStatus, message: failure instanceof Error ? failure.message : "Report checks could not load." }); }
    } finally { if (current()) { reading.current = false; setLoading(false); } }
  }, [orgId, eventKey, schemaId, fieldKey, status]);
  useEffect(() => {
    if (!active) { mounted.current = false; return; }
    mounted.current = true; void load(null);
    return () => { mounted.current = false; ++generation.current; reading.current = false; abort.current?.abort(); };
  }, [load, active]);
  const failure = error ? loadFailureCopy(classifyLoadFailure({ ...error, online: typeof navigator === "undefined" ? true : navigator.onLine }), { message: error.message }) : null;
  return <>
    <div className="scout-quality-report-toolbar"><p className="app-muted">TBA outcomes cached when checked. Only this original form version is included.</p>
      <Button type="button" variant="secondary" disabled={loading} onClick={() => void load(null)}>{loading ? "Loading…" : "Refresh reports"}</Button>
    </div>
    {failure ? <EmptyState title={failure.title} description={failure.description} badge={failure.badge}>
      {failure.primary ? <Button as="a" variant="secondary" href={failure.primary.href}>{failure.primary.label}</Button> : null}
    </EmptyState> : null}
    {stale && reports.length ? <p className="app-muted">Previously confirmed reports remain shown. Refresh before loading more.</p> : null}
    {confirmed && !stale && !enabled ? <p className="app-muted">Checking is disabled for this question. Its saved evidence is excluded from quality scores.</p> : null}
    {confirmed && !stale && enabled && !reports.length ? <p className="app-muted">{status === "conflict" ? "No current comparable checks need review for this question." : "No current comparable checks are available for this question."}</p> : null}
    <ol className="scout-quality-report-list">{reports.map(report => <li key={report.validationId}>
      <header><div><strong>{labelForMatchKey(report.matchKey) ?? report.matchKey} · Team {report.teamKey.replace(/^frc/i, "")}</strong>
        <small className="app-muted">{scoutEntryByline({ scoutName: report.scoutName, source: report.source })}</small></div>
        <span className={report.status === "conflict" ? "needs-review" : "agrees"}>{report.status === "conflict" ? "Needs review" : "Agrees"}</span>
      </header>
      <dl><div><dt>Scout answer</dt><dd>{qualityAnswerLabel(report.scoutValue)}</dd></div>
        <div><dt>Official outcome</dt><dd>{qualityAnswerLabel(report.officialValue)}</dd></div></dl>
      <small className="app-muted">Checked {new Date(report.checkedAt).toLocaleString()} · Report saved {new Date(report.updatedAt).toLocaleString()}</small>
    </li>)}</ol>
    {next ? <Button type="button" variant="secondary" disabled={loading || stale} onClick={() => void load(next)}>Load more reports</Button> : null}
  </>;
}
