"use client";

import { useCallback, useEffect, useState } from "react";
import { memberLeaderboard, type BuildHoursView, type HourLog } from "../../../lib/build-hours";

type ActionBody = Record<string, unknown> & { action: string; orgId: string };

function elapsedLabel(clockIn: string, now: number): string {
  const ms = now - new Date(clockIn).getTime();
  if (!Number.isFinite(ms) || ms < 0) return "0:00";
  const totalMinutes = Math.floor(ms / 60_000);
  return `${Math.floor(totalMinutes / 60)}:${String(totalMinutes % 60).padStart(2, "0")}`;
}

/**
 * Shop-door kiosk: runs on a signed-in mentor/admin device; members tap their
 * name to clock in or out. Non-admin sessions can still self-toggle.
 */
export default function KioskClient() {
  const [view, setView] = useState<BuildHoursView | null>(null);
  const [error, setError] = useState("");
  const [fetchFailed, setFetchFailed] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 15_000);
    return () => clearInterval(timer);
  }, []);

  const load = useCallback(async () => {
    setFetchFailed(false);
    const params = new URLSearchParams(window.location.search);
    const orgId = params.get("orgId");
    try {
      const response = await fetch(`/api/hours${orgId ? `?orgId=${encodeURIComponent(orgId)}` : ""}`);
      const data = (await response.json()) as BuildHoursView | { error?: string };
      if (!response.ok || !("status" in data)) {
        setError("error" in data && data.error ? data.error : "Could not load the kiosk.");
        setFetchFailed(true);
        return;
      }
      setError("");
      setView(data);
      setNow(Date.now());
    } catch {
      setFetchFailed(true);
    }
  }, []);

  useEffect(() => {
    void load();
    const timer = setInterval(() => void load(), 60_000);
    return () => clearInterval(timer);
  }, [load]);

  const run = useCallback(
    async (body: ActionBody, key: string) => {
      setBusyId(key);
      setError("");
      try {
        const response = await fetch("/api/hours", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        });
        const data = (await response.json()) as { error?: string };
        if (!response.ok) {
          setError(data.error ?? "Action failed.");
          return;
        }
        await load();
      } catch {
        setError("Network error — try again.");
      } finally {
        setBusyId(null);
      }
    },
    [load],
  );

  if (fetchFailed || !view || view.status === "setup_required") {
    return (
      <main className="module-page hours-page hours-kiosk">
        <header className="app-page-header">
          <div>
            <span className="breadcrumbs">Team / Build Hours / Kiosk</span>
            <h1>Shop Kiosk</h1>
          </div>
        </header>
        <div className="app-card hours-empty">
          {view?.status === "setup_required" ? (
            <>
              <strong>Select a team workspace</strong>
              <p className="app-muted">{view.message}</p>
              <a className="app-button" href="/workspace">
                Choose workspace
              </a>
            </>
          ) : fetchFailed ? (
            <>
              <strong>Could not load the kiosk</strong>
              <p className="app-muted">{error || "Check the connection and try again."}</p>
              <button type="button" className="app-button secondary" onClick={() => void load()}>
                Retry
              </button>
            </>
          ) : (
            <p className="app-muted">Loading kiosk…</p>
          )}
        </div>
      </main>
    );
  }

  const { context, records, policy, members } = view;
  const orgId = context.orgId ?? "";
  const selfId = context.userId ?? "";
  const canAdmin = context.role === "owner" || context.role === "admin";
  const board = memberLeaderboard(records, members, policy.seasonGoalHours, now);
  const openByUser = new Map<string, HourLog>(
    records.filter((record) => record.clockOut == null).map((record) => [record.userId, record]),
  );
  const hereCount = openByUser.size;

  const toggle = (memberId: string) => {
    const open = openByUser.get(memberId);
    if (open) {
      void run({ action: "clock_out", orgId, recordId: open.id }, memberId);
    } else {
      void run({ action: "clock_in", orgId, ...(memberId === selfId ? {} : { userId: memberId }) }, memberId);
    }
  };

  return (
    <main className="module-page hours-page hours-kiosk">
      <header className="app-page-header">
        <div>
          <span className="breadcrumbs">Team / Build Hours / Kiosk</span>
          <h1>Shop Kiosk</h1>
          <p>
            Tap your name to clock in or out · {hereCount} in the shop right now
            {context.orgName ? ` · ${context.orgName}` : ""}
          </p>
        </div>
        <a className="app-button secondary" href={orgId ? `/hours?orgId=${encodeURIComponent(orgId)}` : "/hours"}>
          Full hours view
        </a>
      </header>

      {error ? (
        <p className="telemetry-status" role="alert">
          {error}
        </p>
      ) : null}
      {!canAdmin ? (
        <p className="app-muted hours-kiosk-hint">
          This device is signed in without owner/admin access — only your own tile will toggle.
        </p>
      ) : null}

      <div className="hours-kiosk-grid">
        {board.map((row) => {
          const open = openByUser.get(row.userId);
          const isSelf = row.userId === selfId;
          const disabled = busyId != null || (!canAdmin && !isSelf);
          return (
            <button
              key={row.userId}
              type="button"
              className={open ? "hours-kiosk-tile in" : "hours-kiosk-tile"}
              disabled={disabled}
              onClick={() => toggle(row.userId)}
            >
              <strong>{row.name ?? "Member"}</strong>
              {open ? (
                <span className="state in">● IN · {elapsedLabel(open.clockIn, now)}</span>
              ) : (
                <span className="state">Tap to clock in</span>
              )}
              <small>
                {row.totalHours}h season{row.goalPercent != null ? ` · ${row.goalPercent}%` : ""}
                {isSelf ? " · you" : ""}
              </small>
            </button>
          );
        })}
      </div>
      {board.length === 0 ? <p className="app-muted">No members found in this organization.</p> : null}
    </main>
  );
}
