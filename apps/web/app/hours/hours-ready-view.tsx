"use client";

import { useState } from "react";
import { AiInsightPanel } from "../../components/ai-insight-panel";
import { Button, PageHeader } from "../../components/ui";
import { OfflineBanner } from "../../components/offline-banner";
import { HOUR_KIND_LABELS, HOUR_KINDS, memberLeaderboard, summarizeHours, type HourKind } from "../../lib/build-hours";
import { HOURS_PAGE_TITLE } from "../../lib/hours/hours-related";
import { EnrollScanForm, ManualEntryForm, PolicyForm, ScanClockForm } from "./hours-forms";
import { HoursRelatedStrip } from "./hours-chrome";
import {
  elapsedLabel,
  fmtClock,
  fmtHours,
  hoursRecordLineHours,
  type HoursRun,
  type ReadyView,
} from "./hours-model";

export function HoursReadyView({
  view,
  now,
  busyKey,
  error,
  fromCache,
  cachedAt,
  pending,
  online,
  kind,
  setKind,
  setBusyKey,
  setError,
  run,
  drain,
  load,
  refreshPending,
}: {
  view: ReadyView;
  now: number;
  busyKey: string | null;
  error: string;
  fromCache: boolean;
  cachedAt: string | null;
  pending: number;
  online: boolean;
  kind: HourKind;
  setKind: (kind: HourKind) => void;
  setBusyKey: (key: string | null) => void;
  setError: (message: string) => void;
  run: HoursRun;
  drain: () => Promise<void>;
  load: () => Promise<void>;
  refreshPending: () => Promise<void>;
}) {
  const [showMyLog, setShowMyLog] = useState(false);
  const { context, records, policy, members } = view;
  const orgId = context.orgId ?? "";
  const selfId = context.userId ?? "";
  const canAdmin = context.role === "owner" || context.role === "admin";
  const summary = summarizeHours(records, now);
  const board = memberLeaderboard(records, members, policy.seasonGoalHours, now);
  const myRow = board.find((row) => row.userId === selfId);
  const myOpen = records.find((record) => record.userId === selfId && record.clockOut == null) ?? null;
  const hereNow = records.filter((record) => record.clockOut == null);
  const myRecords = records.filter((record) => record.userId === selfId);
  const busy = busyKey != null;

  return (
    <main className="module-page hours-page">
      <PageHeader
        breadcrumbs="Team / Hours"
        title={HOURS_PAGE_TITLE}
        description={`Shop-time tracking for ${context.orgName ?? "your team"}${
          context.teamNumber ? ` (Team ${context.teamNumber})` : ""
        }${policy.seasonGoalHours > 0 ? ` · season goal ${fmtHours(policy.seasonGoalHours)} per member` : ""}.`}
      >
        <HoursRelatedStrip orgId={orgId} />
        <div className="hours-header-actions">
          {pending > 0 ? (
            <Button variant="secondary" type="button" disabled={busy || !online} onClick={() => void drain()}>
              Sync {pending} queued scan{pending === 1 ? "" : "s"}
            </Button>
          ) : null}
          {orgId ? (
            <Button
              as="a"
              variant="secondary"
              href={`/api/hours/export?orgId=${encodeURIComponent(orgId)}`}
              title={canAdmin ? "Download the team's hours as CSV" : "Download your hours as CSV"}
            >
              Export CSV
            </Button>
          ) : null}
          {canAdmin && summary.hereNow > 0 ? (
            <Button
              variant="secondary"
              type="button"
              disabled={busy}
              onClick={() => {
                if (
                  confirm(
                    `Sign out all ${summary.hereNow} clocked-in member(s)? Sessions left open from an earlier day are capped at your team's auto-close credit instead of being signed out now.`,
                  )
                ) {
                  void run({ action: "close_all_open", orgId }, "close-all");
                }
              }}
            >
              End meeting (sign all out)
            </Button>
          ) : null}
        </div>
      </PageHeader>

      <OfflineBanner feature="Hours" fromCache={fromCache} cachedAt={cachedAt} />

      {error ? (
        <p className="telemetry-status" role="alert">
          {error}
        </p>
      ) : null}

      <section className="app-card hours-clock-card" aria-label="Scan a card or clock in" id="hours-clock">
        <ScanClockForm
          orgId={orgId}
          kind={kind}
          setKind={setKind}
          busy={busy}
          onBusy={(next) => setBusyKey(next ? "scan" : null)}
          onMessage={(message) => {
            setError(message);
            void refreshPending();
          }}
          onSynced={async () => {
            await load();
            await refreshPending();
          }}
        />
      </section>
      {!online ? (
        <p className="hours-kiosk-hint app-muted" role="status">
          Offline — scans are queued on this device with the time they happened. Totals below stay at the last
          loaded records; they are not guessed while the queue drains.
        </p>
      ) : null}

      <section className="app-card hours-clock-card" aria-label="Clock in or out">
        <div className="hours-clock-state">
          {myOpen ? (
            <>
              <strong>
                You're clocked in <span className="elapsed">· {elapsedLabel(myOpen.clockIn, now)}</span>
              </strong>
              <span>
                Since {fmtClock(myOpen.clockIn)} · {HOUR_KIND_LABELS[myOpen.kind]}
              </span>
            </>
          ) : (
            <>
              <strong>You're not clocked in</strong>
              <span>
                {myRow ? `${fmtHours(myRow.totalHours)} logged this season` : "No hours logged yet"}
                {myRow?.goalPercent != null ? ` · ${myRow.goalPercent}% of goal` : ""}
              </span>
            </>
          )}
        </div>
        <div className="hours-clock-actions">
          {!myOpen ? (
            <>
              <select value={kind} disabled={busy} aria-label="Session kind" onChange={(e) => setKind(e.target.value as HourKind)}>
                {HOUR_KINDS.map((value) => (
                  <option key={value} value={value}>
                    {HOUR_KIND_LABELS[value]}
                  </option>
                ))}
              </select>
              <Button
                variant="primary"
                type="button"
                className="hours-big-btn"
                disabled={busy}
                onClick={() => void run({ action: "clock_in", orgId, kind }, "clock")}
              >
                Clock in
              </Button>
            </>
          ) : (
            <Button
              variant="danger"
              type="button"
              className="hours-big-btn out"
              disabled={busy}
              onClick={() => void run({ action: "clock_out", orgId }, "clock")}
            >
              Clock out
            </Button>
          )}
        </div>
      </section>

      <div className="hours-summary">
        <div className="hours-summary-tile live">
          <strong>{summary.hereNow}</strong>
          <span>here now</span>
        </div>
        <div className="hours-summary-tile">
          <strong>{fmtHours(summary.totalHours)}</strong>
          <span>team total</span>
        </div>
        <div className="hours-summary-tile">
          <strong>{summary.activeMembers}</strong>
          <span>members logging</span>
        </div>
        <div className="hours-summary-tile">
          <strong>{summary.avgHours == null ? "—" : fmtHours(summary.avgHours)}</strong>
          <span>avg / member</span>
        </div>
      </div>

      <div className="hours-layout">
        <section className="hours-panel">
          <h2>Season hours</h2>
          <ol className="hours-board">
            {board.map((row, index) => (
              <li key={row.userId} className={row.userId === selfId ? "me" : undefined}>
                <span className="rank">{index + 1}</span>
                <span className="who">
                  <strong>{row.name ?? "Member"}</strong>
                  {row.openRecordId ? <em>● IN</em> : null}
                </span>
                <span className="total">
                  {fmtHours(row.totalHours)}
                  {row.goalPercent != null ? ` · ${row.goalPercent}%` : ""}
                </span>
                {row.goalPercent != null ? (
                  <span className="goal-track" aria-hidden="true">
                    <i className={row.goalPercent >= 100 ? "done" : undefined} style={{ width: `${row.goalPercent}%` }} />
                  </span>
                ) : null}
              </li>
            ))}
          </ol>
          {hereNow.length > 0 ? (
            <>
              <h2>In the shop right now</h2>
              <ul className="hours-here">
                {hereNow.map((record) => (
                  <li key={record.id}>
                    <span>
                      {record.userName ?? "Member"} · {HOUR_KIND_LABELS[record.kind]}
                    </span>
                    <span>
                      <b>{elapsedLabel(record.clockIn, now)}</b>
                      {canAdmin || record.userId === selfId ? (
                        <>
                          {" "}
                          <Button
                            variant="ghost"
                            type="button"
                            className="hours-link"
                            disabled={busy}
                            onClick={() => void run({ action: "clock_out", orgId, recordId: record.id }, `out:${record.id}`)}
                          >
                            Sign out
                          </Button>
                        </>
                      ) : null}
                    </span>
                  </li>
                ))}
              </ul>
            </>
          ) : null}
        </section>

        <section className="hours-panel">
          <div className="hours-forms">
            <ManualEntryForm orgId={orgId} members={members} canAdmin={canAdmin} selfId={selfId} busy={busyKey === "manual"} run={run} />
            {canAdmin ? (
              <EnrollScanForm orgId={orgId} members={members} busy={busyKey === "enroll"} run={run} />
            ) : null}
            {canAdmin ? <PolicyForm orgId={orgId} policy={policy} busy={busyKey === "policy"} run={run} /> : null}
          </div>
          <h2>
            {showMyLog ? "My entries" : "Recent entries"}{" "}
            <Button variant="ghost" type="button" className="hours-link" onClick={() => setShowMyLog((value) => !value)}>
              {showMyLog ? "Show all" : "Show mine"}
            </Button>
          </h2>
          <ul className="hours-log">
            {(showMyLog ? myRecords : records).slice(0, 25).map((record) => (
              <li key={record.id} className={record.clockOut == null ? "open" : undefined}>
                <span className="session">
                  <strong>
                    {!showMyLog ? `${record.userName ?? "Member"} · ` : ""}
                    {fmtClock(record.clockIn)}
                    {record.clockOut ? ` → ${fmtClock(record.clockOut)}` : " → now"}
                  </strong>
                  {record.note ? <small>{record.note}</small> : null}
                </span>
                <span className="hours-kind">{HOUR_KIND_LABELS[record.kind]}</span>
                <b className="dur">{hoursRecordLineHours(record, now)}</b>
                <Button
                  variant="ghost"
                  type="button"
                  className="hours-link danger"
                  aria-label="Delete entry"
                  disabled={busy}
                  onClick={() => {
                    if (confirm("Delete this hours entry?")) {
                      void run({ action: "delete_record", orgId, id: record.id }, `del:${record.id}`);
                    }
                  }}
                >
                  ✕
                </Button>
              </li>
            ))}
          </ul>
          {(showMyLog ? myRecords : records).length === 0 ? (
            <p className="app-muted">No entries yet — clock in or add hours manually.</p>
          ) : null}
        </section>
      </div>

      {canAdmin ? (
        <AiInsightPanel
          orgId={orgId}
          kind="engagement_digest"
          title="Who to check in with"
          description="Participation from logged hours — who is on track, and who has not clocked in."
        />
      ) : null}
    </main>
  );
}
