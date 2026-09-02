"use client";

import { useMemo, useState } from "react";
import type { RosterMember, ShiftView } from "../../../lib/scouting/shift-store";
import {
  DEFAULT_BREAK_EVERY,
  DEFAULT_MAX_CONSECUTIVE,
  type ShiftAlliance,
  type ShiftStation,
} from "../../../lib/scouting/shifts";

type Props = {
  orgId: string;
  eventKey: string;
  shifts: ShiftView[];
  roster: RosterMember[];
  canManage: boolean;
  matchRange: { min: number; max: number } | null;
  gapMatches: number;
  onChanged: () => void | Promise<void>;
};

type ActionSummary = {
  ok?: boolean;
  message?: string;
  error?: string;
  notified?: number;
  unscoutedSlots?: number;
};

function notifyLabel(shift: ShiftView): string {
  if (shift.notifyState === "sent" && shift.lastNotifiedAt) {
    return `Notified ${new Date(shift.lastNotifiedAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`;
  }
  if (shift.notifyState === "due") return "Reminder due now";
  if (shift.notifyState === "scheduled") return `Reminder ${shift.notifyMinutesBefore}m before`;
  return "No match time yet";
}

function startsLabel(shift: ShiftView): string {
  if (!shift.startsAt) return "time TBD";
  return new Date(shift.startsAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

/**
 * Per-scout shift timeline for /scouting/lineup. Reads the shifts the coverage route
 * returns and writes back through its POST actions — every write also updates the
 * scout_assignments rows the gap board counts, so the two views cannot drift.
 */
export function ShiftRoster({ orgId, eventKey, shifts, roster, canManage, matchRange, gapMatches, onChanged }: Props) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [breakEvery, setBreakEvery] = useState(DEFAULT_BREAK_EVERY);
  const [maxConsecutive, setMaxConsecutive] = useState(DEFAULT_MAX_CONSECUTIVE);
  const [notify, setNotify] = useState(true);
  const [assignUser, setAssignUser] = useState("");
  const [assignFrom, setAssignFrom] = useState<number | "">("");
  const [assignTo, setAssignTo] = useState<number | "">("");
  const [assignAlliance, setAssignAlliance] = useState<ShiftAlliance>("red");
  const [assignStation, setAssignStation] = useState<ShiftStation>(1);
  const [swapWith, setSwapWith] = useState("");
  const [reassignTo, setReassignTo] = useState("");

  const selected = shifts.find((shift) => shift.id === selectedId) ?? null;
  const span = matchRange ? matchRange.max - matchRange.min + 1 : 0;

  const rows = useMemo(() => {
    const byUser = new Map<string, { userId: string; name: string; shifts: ShiftView[] }>();
    for (const shift of shifts) {
      const row = byUser.get(shift.userId) ?? { userId: shift.userId, name: shift.userName ?? "Team scout", shifts: [] };
      row.shifts.push(shift);
      byUser.set(shift.userId, row);
    }
    return [...byUser.values()].sort(
      (a, b) => Math.min(...a.shifts.map((s) => s.matchStart)) - Math.min(...b.shifts.map((s) => s.matchStart)) || a.name.localeCompare(b.name),
    );
  }, [shifts]);
  const unrostered = roster.filter((member) => !rows.some((row) => row.userId === member.userId));
  const dueCount = shifts.filter((shift) => shift.notifyState === "due").length;

  async function post(body: Record<string, unknown>): Promise<void> {
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch("/api/scouting/coverage", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ orgId, eventKey, ...body }),
      });
      const data = (await response.json()) as ActionSummary;
      if (!response.ok) {
        setMessage(data.error ?? "Shift update failed.");
        return;
      }
      setMessage(
        [data.message, data.notified ? `${data.notified} notified` : null].filter(Boolean).join(" · ") || "Saved.",
      );
      setSelectedId(null);
      await onChanged();
    } catch {
      setMessage("Network error — the roster did not change.");
    } finally {
      setBusy(false);
    }
  }

  const axisTicks = useMemo(() => {
    if (!matchRange || span <= 0) return [];
    const ticks = new Set<number>([matchRange.min, matchRange.max]);
    const step = Math.max(1, Math.round(span / 6));
    for (let n = matchRange.min + step; n < matchRange.max; n += step) ticks.add(n);
    return [...ticks].sort((a, b) => a - b);
  }, [matchRange, span]);

  return (
    <section className="lineup-shifts" aria-label="Shift roster" id="lineup-shifts">
      <header>
        <div>
          <h2>Shift roster</h2>
          <p className="app-muted">
            {shifts.length
              ? `${shifts.length} shift${shifts.length === 1 ? "" : "s"} across ${rows.length} scout${rows.length === 1 ? "" : "s"}${
                  gapMatches ? ` · ${gapMatches} match${gapMatches === 1 ? "" : "es"} with an open robot slot` : " · every robot slot covered"
                }`
              : "No shifts planned yet — assignments expand from shifts, so the gap board stays honest."}
          </p>
        </div>
        {canManage && dueCount ? (
          <button type="button" className="app-button secondary" disabled={busy} onClick={() => void post({ action: "notify-due" })}>
            Notify {dueCount} due
          </button>
        ) : null}
      </header>

      {message ? (
        <p className="form-message" role="status">
          {message}
        </p>
      ) : null}

      {canManage ? (
        <div className="lineup-shift-forms">
          <form
            className="lineup-shift-form"
            onSubmit={(event) => {
              event.preventDefault();
              void post({ action: "auto-assign", breakEvery, maxConsecutive, notify });
            }}
          >
            <strong>Auto-assign the roster</strong>
            <label>
              Break every
              <input type="number" min={1} max={40} value={breakEvery} onChange={(e) => setBreakEvery(Number(e.target.value) || DEFAULT_BREAK_EVERY)} />
            </label>
            <label>
              Max in a row
              <input type="number" min={1} max={60} value={maxConsecutive} onChange={(e) => setMaxConsecutive(Number(e.target.value) || DEFAULT_MAX_CONSECUTIVE)} />
            </label>
            <label className="lineup-check">
              <input type="checkbox" checked={notify} onChange={(e) => setNotify(e.target.checked)} />
              Notify scouts
            </label>
            <button type="submit" className="app-button" disabled={busy || !matchRange || !roster.length}>
              {shifts.length ? "Re-plan all shifts" : "Plan shifts"}
            </button>
            <small className="app-muted">
              Rotates {roster.length} member{roster.length === 1 ? "" : "s"} across six robot slots; replaces the current plan.
            </small>
          </form>

          <form
            className="lineup-shift-form"
            onSubmit={(event) => {
              event.preventDefault();
              if (!assignUser || assignFrom === "" || assignTo === "") {
                setMessage("Pick a scout and a match range.");
                return;
              }
              void post({
                action: "assign",
                userId: assignUser,
                matchStart: assignFrom,
                matchEnd: assignTo,
                alliance: assignAlliance,
                station: assignStation,
                notify,
              });
            }}
          >
            <strong>Assign one shift</strong>
            <label>
              Scout
              <select value={assignUser} onChange={(e) => setAssignUser(e.target.value)}>
                <option value="">Choose…</option>
                {roster.map((member) => (
                  <option key={member.userId} value={member.userId}>
                    {member.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              From QM
              <input
                type="number"
                min={matchRange?.min ?? 1}
                max={matchRange?.max ?? 999}
                value={assignFrom}
                onChange={(e) => setAssignFrom(e.target.value === "" ? "" : Number(e.target.value))}
              />
            </label>
            <label>
              To QM
              <input
                type="number"
                min={matchRange?.min ?? 1}
                max={matchRange?.max ?? 999}
                value={assignTo}
                onChange={(e) => setAssignTo(e.target.value === "" ? "" : Number(e.target.value))}
              />
            </label>
            <label>
              Alliance
              <select value={assignAlliance} onChange={(e) => setAssignAlliance(e.target.value === "blue" ? "blue" : "red")}>
                <option value="red">Red</option>
                <option value="blue">Blue</option>
              </select>
            </label>
            <label>
              Station
              <select value={assignStation} onChange={(e) => setAssignStation(Number(e.target.value) as ShiftStation)}>
                <option value={1}>1</option>
                <option value={2}>2</option>
                <option value={3}>3</option>
              </select>
            </label>
            <button type="submit" className="app-button secondary" disabled={busy || !matchRange}>
              Assign
            </button>
          </form>
        </div>
      ) : null}

      {matchRange && rows.length ? (
        <div className="lineup-shift-timeline" role="table" aria-label="Shift timeline">
          <div className="lineup-shift-row lineup-shift-axis" role="row">
            <span className="lineup-shift-name" aria-hidden="true" />
            <div className="lineup-shift-track" style={{ gridTemplateColumns: `repeat(${span}, minmax(0, 1fr))` }}>
              {axisTicks.map((tick) => (
                <small key={tick} style={{ gridColumn: `${tick - matchRange.min + 1} / span 1` }}>
                  {tick}
                </small>
              ))}
            </div>
          </div>
          {rows.map((row) => (
            <div key={row.userId} className="lineup-shift-row" role="row">
              <span className="lineup-shift-name" role="cell">
                {row.name}
              </span>
              <div className="lineup-shift-track" role="cell" style={{ gridTemplateColumns: `repeat(${span}, minmax(0, 1fr))` }}>
                {row.shifts.map((shift) => (
                  <button
                    key={shift.id}
                    type="button"
                    className={`lineup-shift-block ${shift.alliance ?? "none"} is-${shift.notifyState}${
                      selectedId === shift.id ? " is-selected" : ""
                    }`}
                    style={{
                      gridColumn: `${shift.matchStart - matchRange.min + 1} / ${shift.matchEnd - matchRange.min + 2}`,
                    }}
                    aria-pressed={selectedId === shift.id}
                    title={`${row.name} · ${shift.label} · starts ${startsLabel(shift)} · ${notifyLabel(shift)}`}
                    onClick={() => setSelectedId((current) => (current === shift.id ? null : shift.id))}
                  >
                    <span>{shift.label}</span>
                    <small>{shift.notifyState === "sent" ? "notified" : shift.notifyState === "due" ? "due" : startsLabel(shift)}</small>
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <p className="app-muted">
          {matchRange
            ? "The timeline fills in once shifts are planned."
            : "Sync the qualification schedule from TBA before planning shifts — nothing is invented."}
        </p>
      )}

      {unrostered.length && rows.length ? (
        <p className="app-muted lineup-shift-idle">
          Without a shift: {unrostered.map((member) => member.name).join(", ")}
        </p>
      ) : null}

      {selected ? (
        <div className="lineup-shift-actions" role="group" aria-label="Selected shift">
          <div>
            <strong>
              {selected.userName ?? "Team scout"} · {selected.label}
            </strong>
            <span className="app-muted">
              Starts {startsLabel(selected)} · {notifyLabel(selected)}
            </span>
          </div>
          {canManage ? (
            <div className="lineup-shift-buttons">
              <button type="button" className="app-button secondary" disabled={busy} onClick={() => void post({ action: "notify", shiftId: selected.id })}>
                Notify now
              </button>
              <label>
                Swap with
                <select value={swapWith} onChange={(e) => setSwapWith(e.target.value)}>
                  <option value="">Choose shift…</option>
                  {shifts
                    .filter((shift) => shift.id !== selected.id)
                    .map((shift) => (
                      <option key={shift.id} value={shift.id}>
                        {shift.userName ?? "Scout"} · {shift.label}
                      </option>
                    ))}
                </select>
              </label>
              <button
                type="button"
                className="app-button secondary"
                disabled={busy || !swapWith}
                onClick={() => void post({ action: "swap", shiftId: selected.id, otherShiftId: swapWith, notify })}
              >
                Swap
              </button>
              <label>
                Hand to
                <select value={reassignTo} onChange={(e) => setReassignTo(e.target.value)}>
                  <option value="">Choose scout…</option>
                  {roster
                    .filter((member) => member.userId !== selected.userId)
                    .map((member) => (
                      <option key={member.userId} value={member.userId}>
                        {member.name}
                      </option>
                    ))}
                </select>
              </label>
              <button
                type="button"
                className="app-button secondary"
                disabled={busy || !reassignTo}
                onClick={() => void post({ action: "reassign", shiftId: selected.id, userId: reassignTo, notify })}
              >
                Reassign
              </button>
              <button type="button" className="app-button secondary danger" disabled={busy} onClick={() => void post({ action: "remove", shiftId: selected.id })}>
                Remove
              </button>
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
