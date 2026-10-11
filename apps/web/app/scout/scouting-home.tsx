"use client";
import { ScoutingSharing } from "../scouting/scouting-sharing";

import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { Button, Skeleton } from "../../components/ui";
import { putFeatureSnapshot } from "../../lib/offline/feature-cache";
import { useOnline } from "../../lib/offline/use-online";
import { warmOfflineRoutes } from "../../lib/offline/warm-routes";
import { loadRoster, saveRoster, prefetchEventTeams, type OfflineRosterTeam } from "../../lib/intel/offline-teams";
import { cacheEvent, getCachedEvent, pendingCounts } from "../../lib/scout-offline";
import { useScoutQueueRefresh } from "../../lib/scouting/use-queue-refresh";
import type { Bootstrap } from "../scouting/scouting-model";
import { SCOUTING_NAV } from "./scouting-shell";
import { hubHref } from "../../lib/nav/hubs";
import { ScoutHomeLead, ScoutHomeMatch, ScoutHomeMe, ScoutHomePit } from "./scout-home-sections";
import { useScoutingSummary } from "../../lib/scouting/use-scouting-summary";
import { readActiveScoutDraft } from "../../lib/scouting/draft-autosave";
import { scoutContext, describeScoutContext } from "../../lib/scouting/scout-context";
import type { ScheduleMatch } from "../../lib/scouting/next-match";
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
  roster?: OfflineRosterTeam[];
};

function formatDutyTime(iso: string): string {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return "";
  const minutes = Math.round((at.getTime() - Date.now()) / 60_000);
  const clock = at.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  if (minutes > 0 && minutes < 90) return `${clock} · in ${minutes} min`;
  if (minutes <= 0 && minutes > -15) return `${clock} · now`;
  return clock;
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
  // "No event set" is an answer, so it waits for one. Before this the hero
  // said it on every first open, for the second the roster took to arrive.
  const [rosterState, setRosterState] = useState<"loading" | "ready" | "failed">("loading");
  const [queue, setQueue] = useState<{ entries: number; media: number; quarantined: number } | null>(null);
  const [storage, setStorage] = useState<DeviceStorage | null>(null);
  const [preparing, setPreparing] = useState(false);
  const [readyNote, setReadyNote] = useState<string | null>(null);
  const [duty, setDuty] = useState<NextDuty | null>(null);
  const [savedEventName, setSavedEventName] = useState<string | null>(null);
  const [savedEventKey, setSavedEventKey] = useState<string | null>(null);
  const [scoutUserId, setScoutUserId] = useState<string | null>(null);
  const [scheduleMatches, setScheduleMatches] = useState<ScheduleMatch[]>([]);
  const summary = useScoutingSummary(orgId);
  const activeOrg = useRef(orgId);
  activeOrg.current = orgId;

  // The person's own next robot, from the same bootstrap the entry form loads. "Already filed"
  // is every robot the team has scouted at the event (not only the latest 30 entries), so Home
  // no longer sends a scout to a robot they have already scouted.
  useEffect(() => {
    if (!orgId) return;
    let cancelled = false;
    setDuty(null);
    setSavedEventName(null);
    setSavedEventKey(null);
    void fetch(`/api/scouting/bootstrap?orgId=${encodeURIComponent(orgId)}`, { cache: "no-store" })
      .then((response) => (response.ok ? response.json() : null))
      .catch(async () => { try { return await getCachedEvent<Bootstrap>(orgId); } catch { return null; } })
      .then(
        (
          data: {
            assignments?: DutyAssignment[];
            matches?: DutyMatch[];
            recentEntries?: DutyEntry[];
            scouted?: Array<{ matchKey: string; teamKey: string }>;
            teamNumber?: number | null;
            scoutIdentity?: { userId?: string } | null;
            eventKey?: string | null;
            eventName?: string | null;
          } | null,
        ) => {
          if (cancelled || !data) return;
          setSavedEventName(data.eventName ?? data.eventKey ?? null);
          setSavedEventKey(data.eventKey ?? null);
          setScoutUserId(data.scoutIdentity?.userId ?? null);
          setScheduleMatches((data.matches ?? []).filter((match): match is ScheduleMatch => typeof match.matchNumber === "number"));
          if (online) void cacheEvent(orgId, data).catch(() => undefined);
          setDuty(
            nextScoutingDuty({
              assignments: data.assignments ?? [],
              matches: data.matches ?? [],
              entries: data.scouted
                ? data.scouted.map((row) => ({ type: "match", matchKey: row.matchKey, teamKey: row.teamKey }))
                : (data.recentEntries ?? []),
            }),
          );
        },
      )
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [orgId, online]);

  useEffect(() => {
    if (!orgId) return;
    let cancelled = false;
    setRoster(null);
    setRosterState("loading");
    void fetch(`/api/intel/teams?orgId=${encodeURIComponent(orgId)}&q=`)
      .then((response) => (response.ok ? (response.json() as Promise<Roster>) : null))
      .then((data) => {
        if (cancelled) return;
        setRoster(data);
        if (data?.roster) void saveRoster(orgId, data.roster).catch(() => undefined);
        setRosterState(data ? "ready" : "failed");
      })
      .catch(async () => {
        // No signal: the event's teams as last saved, so pit coverage still shows.
        const saved = await loadRoster(orgId);
        if (cancelled) return;
        if (saved?.roster.length) {
          setRoster({ roster: saved.roster });
          setRosterState("ready");
        } else {
          setRosterState("failed");
        }
      });
    return () => {
      cancelled = true;
    };
  }, [orgId, online]);

  const refreshDevice = useCallback(async () => {
    try {
      const [counts, device] = await Promise.all([pendingCounts(orgId ?? undefined), deviceStorageSummary()]);
      if (activeOrg.current !== orgId) return;
      setQueue(counts);
      setStorage(device);
    } catch {
      if (activeOrg.current !== orgId) return;
      setQueue(null);
    }
  }, [orgId]);
  useScoutQueueRefresh(refreshDevice);

  /*
    One tap before the venue. Three things a scout would otherwise have to know to do:
    ask the browser to keep this site's data, save this event's forms, assignments,
    predictions and pick list where each page looks for its offline copy, and have the
    service worker store every Scouting page with its scripts. The note says exactly
    what was saved — pages only when the worker confirms it.
  */
  async function getReady() {
    if (!orgId) return;
    setPreparing(true);
    const saved: string[] = [];
    let recordingReady = false;
    const org = encodeURIComponent(orgId);
    const read = async (url: string): Promise<unknown> => {
      try {
        const response = await fetch(url, { cache: "no-store" });
        return response.ok ? await response.json() : null;
      } catch {
        return null;
      }
    };
    try {
      try {
        await navigator.storage?.persist?.();
      } catch {
        // Not every browser offers it; the rest still helps.
      }
      const bootstrap = await read(`/api/scouting/bootstrap?orgId=${org}`) as Bootstrap | null;
      if (bootstrap) {
        await cacheEvent(orgId, bootstrap);
        await putFeatureSnapshot("scouting", orgId, bootstrap);
        recordingReady = Boolean(bootstrap.eventKey && bootstrap.schemas?.length);
        saved.push(recordingReady ? "forms and assignments" : "the event setup");
      }
      const coverage = await read(`/api/scouting/summary?orgId=${org}`);
      if (coverage) {
        await putFeatureSnapshot("scouting-summary", orgId, coverage);
        saved.push("pit and match coverage");
      }
      const predictions = await read(`/api/match-sim?orgId=${org}`);
      if (predictions) {
        await putFeatureSnapshot("match-sim", orgId, predictions);
        saved.push("predictions");
      }
      const analysis = await read(`/api/scouting/teams?orgId=${org}`);
      if (analysis) {
        await putFeatureSnapshot("scouting-teams", orgId, analysis);
        saved.push("robot comparisons");
      }
      const schedule = (await read(`/api/schedule?orgId=${org}`)) as { status?: string } | null;
      if (schedule?.status === "ready") {
        await putFeatureSnapshot("schedule", orgId, schedule);
        saved.push("the match schedule");
      }
      const picklist = await read(`/api/picklist-collab?orgId=${org}`);
      if (picklist) {
        await putFeatureSnapshot("picklist-collab", orgId, picklist);
        saved.push("the pick list");
      }
      // Every team at the event, so the Teams tab can look any of them up with no signal.
      const teams = await prefetchEventTeams(orgId, {
        onProgress: (done, total) => setReadyNote(`Saving the event's teams… ${done} of ${total}`),
      });
      if (teams && teams.saved > 0) {
        saved.push(teams.saved === 1 ? "one team's page" : `${teams.saved} teams' pages`);
      }
      // The full form too: pit scouting and corrections live there.
      const warmed = await warmOfflineRoutes([...SCOUTING_NAV.map((item) => withOrg(item.href)), withOrg("/scout/entry"), withOrg("/scout/predict")]);
      const data =
        saved.length > 1 ? `${saved.slice(0, -1).join(", ")} and ${saved[saved.length - 1]}` : (saved[0] ?? null);
      if (warmed && warmed.pages > 0) {
        setReadyNote(
          `Saved ${warmed.pages} pages${data ? ` and ${data}` : ""}. ${recordingReady ? "This phone can scout with no signal." : "Set an event and publish its forms before event scouting works offline."}`,
        );
      } else if (data) {
        setReadyNote(
          `Saved ${data}. Each page is kept the first time you open it online — open the tabs once before you lose signal.`,
        );
      } else {
        setReadyNote("Nothing could be saved. Check the connection and try again.");
      }
    } catch (error) {
      setReadyNote(`${saved.length ? `Saved ${saved.join(", ")}. ` : ""}${error instanceof Error ? error.message : "Could not save the offline copy. Your existing saved data is unchanged."}`);
    } finally {
      setPreparing(false);
      await refreshDevice();
    }
  }

  const withOrg = (href: string) => (orgId ? `${href}?orgId=${encodeURIComponent(orgId)}` : href);
  const rosterLoading = Boolean(orgId) && rosterState === "loading";
  const eventKey = roster?.activeEvent?.eventKey ?? savedEventKey;
  const eventName = roster?.activeEvent?.eventName ?? roster?.activeEvent?.eventKey ?? savedEventName;

  const view = summary.view?.status === "ready" ? summary.view : null;
  const pitPageHref = (teamKey?: string) =>
    `${withOrg("/scout/pit")}${teamKey ? `${orgId ? "&" : "?"}teamKey=${encodeURIComponent(teamKey)}` : ""}`;
  const matchHref = duty
    ? `${withOrg("/scout/match")}${orgId ? "&" : "?"}matchKey=${encodeURIComponent(duty.matchKey)}&teamKey=${encodeURIComponent(duty.teamKey)}`
    : withOrg("/scout/match");
  const draft = orgId && scoutUserId && eventKey ? readActiveScoutDraft({ userId: scoutUserId, orgId, eventKey }) : null;
  const resume = draft
    ? draft.type === "pit"
      ? { href: pitPageHref(draft.teamKey), label: `pit visit for ${draft.teamKey.replace(/^frc/, "")}` }
      : (() => {
          const context = scoutContext({ matches: scheduleMatches, matchKey: draft.matchKey, teamKey: draft.teamKey });
          return {
            href: `${withOrg("/scout/match")}${orgId ? "&" : "?"}matchKey=${encodeURIComponent(draft.matchKey)}&teamKey=${encodeURIComponent(draft.teamKey)}`,
            label: context ? describeScoutContext(context) : draft.teamKey.replace(/^frc/, ""),
          };
        })()
    : null;
  const summaryLoading = Boolean(orgId) && summary.status === "loading" && !summary.view;
  // Pits first, except in the minutes before your own robot plays: then that match leads.
  const dutyAt = duty?.startsAt ? Date.parse(duty.startsAt) : NaN;
  const matchSoon = Number.isFinite(dutyAt) && dutyAt - Date.now() < 15 * 60_000;

  return (
    <main className="scout-home">
      <section className="scout-home-hero" aria-labelledby="scout-home-title" aria-busy={rosterLoading || summaryLoading || undefined}>
        {rosterLoading && !eventName ? (
          <p className="scout-home-eyebrow" aria-hidden="true">
            <Skeleton width={180} height={12} />
          </p>
        ) : (
          <p className="scout-home-eyebrow">{eventName ?? (orgId ? rosterState === "failed" ? "Event unavailable" : "No event set" : "No team chosen")}</p>
        )}
        <h1 id="scout-home-title">Scouting</h1>
        {!orgId ? (
          <p className="scout-home-lede">Choose your team in Vantage, then come back here to scout.</p>
        ) : summary.view?.status === "no_event" ? (
          <p className="scout-home-lede">
            {summary.view.canLead ? "Set the event you are at, and its pits and matches show up here." : "A scouting lead sets the event. Once they do, its pits and matches show up here."}
          </p>
        ) : summary.cachedAt ? (
          <p className="scout-home-lede">Offline · these numbers are this phone’s last copy.</p>
        ) : null}
        {summary.view?.status === "no_event" && summary.view.canLead && orgId ? (
          <div className="scout-home-actions">
            <Button as="a" variant="primary" href={hubHref("/competition", "command", orgId)}>
              Set the event
            </Button>
          </div>
        ) : null}
      </section>

      {summaryLoading ? (
        <div className="scout-home-cards" aria-hidden="true">
          <Skeleton height={190} />
          <Skeleton height={190} />
        </div>
      ) : view ? (
        <>
          <div className={`scout-home-cards${matchSoon ? " is-match-first" : ""}`}>
            <ScoutHomePit view={view} pitHref={pitPageHref} primary={!matchSoon} />
            <ScoutHomeMatch
              view={view}
              matchHref={matchHref}
              primary={matchSoon}
              duty={duty ? { teamNumber: duty.teamNumber, matchLabel: duty.matchLabel, station: duty.station, when: duty.startsAt ? formatDutyTime(duty.startsAt) : null } : null}
            />
          </div>
          <ScoutHomeMe view={view} resume={resume} />
          {view.canLead && orgId ? <ScoutHomeLead view={view} orgId={orgId} withOrg={withOrg} /> : null}
        </>
      ) : orgId && summary.status === "failed" ? (
        <div className="scout-home-cards">
          <section className="scout-card">
            <header>
              <h2>Scouting numbers didn’t load</h2>
            </header>
            <p className="scout-card-note">You can still scout; this summary comes back when the connection does.</p>
            <div className="scout-home-actions">
              <Button as="a" variant="primary" href={pitPageHref()}>
                Pit scouting
              </Button>
              <Button as="a" variant="secondary" href={withOrg("/scout/match")}>
                Match scouting
              </Button>
            </div>
          </section>
        </div>
      ) : null}

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
            <dd className={queue && queue.quarantined > 0 ? "is-warn" : undefined}>
              {queue && queue.quarantined > 0 ? (
                // The entries the server set aside, with Retry and Discard, on the Scout page.
                <a href={`${withOrg("/scout/entry")}#needs-a-look`}>{queue.quarantined}</a>
              ) : queue ? (
                queue.quarantined
              ) : (
                "—"
              )}
            </dd>
          </div>
        </dl>
        {storage?.usage != null || storage?.available != null ? (
          <details className="scout-home-storage">
            <summary data-disclosure>
              Device storage <span aria-hidden="true">▾</span>
            </summary>
            <dl className="scout-home-facts">
              <div>
                <dt>Stored here</dt>
                <dd>{storage?.usage != null ? formatBytes(storage.usage) : "—"}</dd>
              </div>
              <div>
                <dt>Room left</dt>
                <dd>{storage?.available != null ? formatBytes(storage.available) : "—"}</dd>
              </div>
            </dl>
            <a href="/account?tab=appearance">Manage offline cache budget</a>
          </details>
        ) : null}
        <div className="scout-home-persist">
          <p role="status">
            {readyNote ??
              (storage?.persisted
                ? "Saved scouting stays on this device until it syncs. Before the venue, save the pages and this event too."
                : "Before you lose signal at the venue, save the Scouting pages and this event on this phone, and keep the browser from clearing them.")}
          </p>
          <Button
            variant="secondary"
            type="button"
            disabled={preparing || !online || !orgId}
            onClick={() => void getReady()}
          >
            {preparing ? "Saving for offline…" : readyNote ? "Save again" : "Get this phone ready"}
          </Button>
        </div>
      </section>

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
      {orgId ? <details className="scout-home-network"><summary>Scouting network and sharing</summary><ScoutingSharing key={orgId} orgId={orgId} /></details> : null}
    </main>
  );
}
