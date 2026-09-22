"use client";

import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { Button } from "../../components/ui";
import { pendingCounts } from "../../lib/scout-offline";
import { deviceStorageSummary, formatBytes, type DeviceStorage } from "../../lib/scouting/device-storage";
import {
  type DutyAssignment,
  type DutyEntry,
  type DutyMatch,
  type NextDuty,
  nextScoutingDuty,
} from "../../lib/scouting/next-duty";

type Roster = {
  activeEvent?: { eventKey?: string | null; eventName?: string | null } | null;
  roster?: Array<{ teamNumber: number; teamKey?: string; nickname: string | null; scouted: number; pitScouted?: number }>;
};

/** The number is already on the chip; a placeholder name ("Team 6925") would say it twice. */
function chipName(team: { teamNumber: number; nickname: string | null }): string {
  const name = team.nickname?.trim() ?? "";
  return name && name.toLowerCase() !== `team ${team.teamNumber}` ? name : "";
}

function formatDutyTime(iso: string): string {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return "";
  const minutes = Math.round((at.getTime() - Date.now()) / 60_000);
  const clock = at.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  if (minutes > 0 && minutes < 90) return `${clock} · in ${minutes} min`;
  if (minutes <= 0 && minutes > -15) return `${clock} · now`;
  return clock;
}

function useOnline(): boolean {
  const [online, setOnline] = useState(true);
  useEffect(() => {
    setOnline(navigator.onLine);
    const up = () => setOnline(true);
    const down = () => setOnline(false);
    window.addEventListener("online", up);
    window.addEventListener("offline", down);
    return () => {
      window.removeEventListener("online", up);
      window.removeEventListener("offline", down);
    };
  }, []);
  return online;
}

/**
 * Scouting's front door: what event, how much is left to watch, and whether
 * this device is safe to scout on. Every number here is read — the roster from
 * the event, the queue from this device's IndexedDB, the storage figures from
 * the browser. Nothing is filled in when a source is missing.
 */
export function ScoutingHome() {
  const orgId = useSearchParams().get("orgId");
  const online = useOnline();
  const [roster, setRoster] = useState<Roster | null>(null);
  const [queue, setQueue] = useState<{ entries: number; media: number; quarantined: number } | null>(null);
  const [storage, setStorage] = useState<DeviceStorage | null>(null);
  const [persisting, setPersisting] = useState(false);
  const [duty, setDuty] = useState<NextDuty | null>(null);

  // The person's own next robot, from the same bootstrap the entry form loads.
  useEffect(() => {
    if (!orgId) return;
    let cancelled = false;
    void fetch(`/api/scouting/bootstrap?orgId=${encodeURIComponent(orgId)}`)
      .then((response) => (response.ok ? response.json() : null))
      .then((data: { assignments?: DutyAssignment[]; matches?: DutyMatch[]; recentEntries?: DutyEntry[] } | null) => {
        if (cancelled || !data) return;
        setDuty(
          nextScoutingDuty({
            assignments: data.assignments ?? [],
            matches: data.matches ?? [],
            entries: data.recentEntries ?? [],
          }),
        );
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [orgId]);

  useEffect(() => {
    if (!orgId) return;
    let cancelled = false;
    void fetch(`/api/intel/teams?orgId=${encodeURIComponent(orgId)}&q=`)
      .then((response) => (response.ok ? (response.json() as Promise<Roster>) : null))
      .then((data) => {
        if (!cancelled) setRoster(data);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [orgId]);

  const refreshDevice = useCallback(async () => {
    try {
      setQueue(await pendingCounts());
    } catch {
      setQueue(null);
    }
    setStorage(await deviceStorageSummary());
  }, []);

  useEffect(() => {
    void refreshDevice();
    const id = window.setInterval(() => void refreshDevice(), 15_000);
    return () => window.clearInterval(id);
  }, [refreshDevice]);

  async function keepOnDevice() {
    setPersisting(true);
    try {
      await navigator.storage?.persist?.();
    } finally {
      setPersisting(false);
      await refreshDevice();
    }
  }

  const withOrg = (href: string) => (orgId ? `${href}?orgId=${encodeURIComponent(orgId)}` : href);
  const teams = roster?.roster ?? [];
  const unscouted = teams.filter((team) => team.scouted === 0);
  const eventName = roster?.activeEvent?.eventName ?? roster?.activeEvent?.eventKey ?? null;
  // Pit coverage only means something once the roster says whether it knows.
  const pitKnown = teams.some((team) => typeof team.pitScouted === "number");
  const pitMissing = teams.filter((team) => (team.pitScouted ?? 0) === 0);
  const pitHref = (teamNumber: number) =>
    `${withOrg("/scout/entry")}${orgId ? "&" : "?"}scoutTab=pit&teamKey=frc${teamNumber}`;

  return (
    <main className="scout-home">
      <section className="scout-home-hero" aria-labelledby="scout-home-title">
        <p className="scout-home-eyebrow">{eventName ?? "No event set"}</p>
        <h1 id="scout-home-title">Scouting</h1>
        <p className="scout-home-lede">
          {teams.length > 0
            ? unscouted.length > 0
              ? `${teams.length} teams at this event · ${unscouted.length} nobody has scouted yet.`
              : `${teams.length} teams at this event · every one has been scouted.`
            : eventName
              ? "The team list for this event has not synced yet."
              : "Set the event you are at in Vantage and the team list appears here."}
        </p>
        {duty ? (
          <p className="scout-home-duty">
            <span>Your next robot</span>
            <strong>
              {duty.teamNumber} · {duty.matchLabel}
              {duty.station ? ` · ${duty.station}` : ""}
            </strong>
            {duty.startsAt ? <small>{formatDutyTime(duty.startsAt)}</small> : null}
          </p>
        ) : null}
        <div className="scout-home-actions">
          <Button
            as="a"
            variant="primary"
            className="scout-home-start"
            href={
              duty
                ? `${withOrg("/scout/entry")}${orgId ? "&" : "?"}matchKey=${encodeURIComponent(duty.matchKey)}&teamKey=${encodeURIComponent(duty.teamKey)}`
                : withOrg("/scout/entry")
            }
          >
            {duty ? `Scout ${duty.teamNumber} in ${duty.matchLabel}` : "Start scouting"}
          </Button>
          <Button as="a" variant="secondary" href={withOrg("/scout/teams")}>
            Look up a team
          </Button>
        </div>
      </section>

      <section className="scout-home-device" aria-label="This device">
        <div className={`scout-home-status ${online ? "is-online" : "is-offline"}`}>
          <span aria-hidden="true" />
          <strong>{online ? "Online" : "Offline — still scouting"}</strong>
          <small>
            {online
              ? "Entries sync as you save them."
              : "Entries save on this device and send themselves when the connection is back."}
          </small>
        </div>
        <dl className="scout-home-facts">
          <div>
            <dt>Waiting to sync</dt>
            <dd>{queue ? queue.entries + queue.media : "—"}</dd>
          </div>
          <div>
            <dt>Needs a look</dt>
            <dd className={queue && queue.quarantined > 0 ? "is-warn" : undefined}>{queue ? queue.quarantined : "—"}</dd>
          </div>
          <div>
            <dt>Stored here</dt>
            <dd>{storage?.usage != null ? formatBytes(storage.usage) : "—"}</dd>
          </div>
          <div>
            <dt>Room left</dt>
            <dd>{storage?.available != null ? formatBytes(storage.available) : "—"}</dd>
          </div>
        </dl>
        {storage && storage.persisted === false && storage.persistSupported ? (
          <div className="scout-home-persist">
            <p>
              This browser may clear saved scouting when space runs low. Keep it on this device so a day of queued
              entries cannot disappear.
            </p>
            <Button variant="secondary" type="button" disabled={persisting} onClick={() => void keepOnDevice()}>
              {persisting ? "Asking the browser…" : "Keep scouting data on this device"}
            </Button>
          </div>
        ) : storage?.persisted ? (
          <p className="scout-home-kept">Saved scouting stays on this device until it syncs.</p>
        ) : null}
      </section>

      {unscouted.length > 0 ? (
        <section className="scout-home-gaps" aria-label="Not scouted yet">
          <h2>Not scouted yet</h2>
          <ul>
            {unscouted.slice(0, 12).map((team) => (
              <li key={team.teamNumber}>
                <a href={`${withOrg("/scout/teams")}${orgId ? "&" : "?"}team=${team.teamNumber}`}>
                  <strong>{team.teamNumber}</strong>
                  <span>{chipName(team)}</span>
                </a>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {pitKnown && teams.length > 0 ? (
        <section className="scout-home-pit" aria-label="Pit scouting">
          <header>
            <h2>Pit scouting</h2>
            <span>
              {teams.length - pitMissing.length} of {teams.length} teams visited
            </span>
          </header>
          <span className="scout-home-meter" aria-hidden="true">
            <i style={{ width: `${Math.round(((teams.length - pitMissing.length) / teams.length) * 100)}%` }} />
          </span>
          {pitMissing.length > 0 ? (
            <ul>
              {pitMissing.slice(0, 16).map((team) => (
                <li key={team.teamNumber}>
                  <a href={pitHref(team.teamNumber)} aria-label={`Pit scout team ${team.teamNumber}`}>
                    <strong>{team.teamNumber}</strong>
                    <span>{chipName(team)}</span>
                  </a>
                </li>
              ))}
            </ul>
          ) : (
            <p className="scout-home-kept">Every team at this event has a pit report.</p>
          )}
        </section>
      ) : null}

      <section className="scout-home-tools" aria-label="Scouting tools">
        <a href={withOrg("/scout/teams")}>
          <strong>Teams</strong>
          <span>Every team at the event, averages and a trend line for each stat you collect.</span>
        </a>
        <a href={withOrg("/scout/predict")}>
          <strong>Predict</strong>
          <span>Put six robots on the field and see who is likely to win, and why.</span>
        </a>
        <a href={withOrg("/scout/picklist")}>
          <strong>Pick list</strong>
          <span>Weigh what your alliance needs and rank every team at the event as you drag.</span>
        </a>
      </section>
    </main>
  );
}
