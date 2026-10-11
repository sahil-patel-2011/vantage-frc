"use client";

import { usePathname, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Button, EmptyState, Skeleton } from "../../../components/ui";
import { useOnline } from "../../../lib/offline/use-online";
import { useViewOnly } from "../../../lib/nav/use-view-only";
import { hubHref } from "../../../lib/nav/hubs";
import { readScoutDraft, scoutDraftStorageKey } from "../../../lib/scouting/draft-autosave";
import { loadFailedCopy } from "../../../lib/scouting/load-state";
import { useScoutingSummary } from "../../../lib/scouting/use-scouting-summary";
import { share } from "../../../lib/scouting/lead-summary";
import { signInHref } from "../../../lib/ui/load-failure";
import { myReports } from "../../scouting/scouting-model";
import { closeQuery, pushQuery, useQueryPopState, useScoutingBootstrap } from "../use-scouting-bootstrap";
import { SaveReceipt } from "../save-receipt";
import { SavedCopyBanner } from "../saved-copy-banner";
import { ScoutViewOnly } from "../scout-view-only";
import { useRobotForm } from "../use-robot-form";
import { useSaveReceipt } from "../use-save-receipt";
import { QuickPitForm } from "./quick-pit-form";
import { QuickPitPicker } from "./quick-pit-picker";

/** " · Citrus Circuits", or nothing when the name is only the placeholder "Team 1678". */
function nameSuffix(team: { teamNumber: number; nickname: string | null }): string {
  const name = team.nickname?.trim() ?? "";
  return name && name.toLowerCase() !== `team ${team.teamNumber}` ? ` · ${name}` : "";
}

/** How many questions a saved-on-this-phone draft answers. */
function answeredCount(payload: Record<string, unknown>): number {
  return Object.entries(payload).filter(([key, value]) => !key.startsWith("_") && value !== undefined && value !== null && value !== "").length;
}

/**
 * Pit scouting: how many pits are left, the next one to walk to, and a big-tile form for
 * the team in front of you. Same forms, outbox and checks as the full Scout form.
 */
export function QuickPitClient({ orgId }: { orgId: string }) {
  const params = useSearchParams();
  const pathname = usePathname() ?? "/scout/pit";
  const requestedEventKey = params.get("eventKey");
  const online = useOnline();
  // View only (0715): no form to fill. The server refuses their reports anyway.
  const viewOnly = useViewOnly(orgId);
  const { data, status, fromCache, cachedAt, failure, retry } = useScoutingBootstrap(orgId, requestedEventKey);
  const summary = useScoutingSummary(orgId);
  const [team, setTeam] = useState<{ teamKey: string; nickname: string | null } | null>(() => {
    const teamKey = params.get("teamKey");
    return teamKey && /^frc\d+$/.test(teamKey) ? { teamKey, nickname: null } : null;
  });
  const { receipt, show: showReceipt, retry: retrySend, clear: clearReceipt } = useSaveReceipt<{ teamNumber: string }>(orgId);
  // Saved on this phone a moment ago: visited, even before the outbox or the server says so.
  const [savedHere, setSavedHere] = useState<string[]>([]);

  const view = summary.view?.status === "ready" ? summary.view : null;
  const teams = (view?.pit.teams ?? []).map((candidate) =>
    savedHere.includes(candidate.teamKey) ? { ...candidate, visited: true } : candidate,
  );
  const nicknameFor = (teamKey: string) => teams.find((candidate) => candidate.teamKey === teamKey)?.nickname ?? null;
  const ownTeamNumber = data?.teamNumber ?? null;

  const open = useCallback(
    (next: { teamKey: string; nickname: string | null }) => {
      clearReceipt();
      setTeam(next);
      pushQuery(pathname, { teamKey: next.teamKey });
    },
    [pathname, clearReceipt],
  );
  const closeTeam = useCallback(() => {
    setTeam(null);
    closeQuery(pathname, { teamKey: null });
  }, [pathname]);
  // The phone's Back (and Forward) between the list and a pit.
  useQueryPopState(
    useCallback((query: URLSearchParams) => {
      const teamKey = query.get("teamKey");
      setTeam(teamKey && /^frc\d+$/.test(teamKey) ? { teamKey, nickname: null } : null);
    }, []),
  );

  // The pit meter moves once the server has the visit.
  const sent = receipt?.status.sync === "sent";
  const reloadSummary = summary.reload;
  useEffect(() => {
    if (sent) reloadSummary();
  }, [sent, reloadSummary]);

  const schema = data?.schemas.find((candidate) => candidate.type === "pit") ?? null;
  const userId = data?.scoutIdentity?.userId ?? null;
  const draftKeyFor = useCallback(
    (teamKey: string) => scoutDraftStorageKey({ userId, orgId, eventKey: data?.eventKey ?? "", entryType: "pit", teamKey }),
    [userId, orgId, data?.eventKey],
  );
  const earlier = useMemo(
    () => (team && data ? myReports(data).find((entry) => entry.type === "pit" && entry.teamKey === team.teamKey) ?? null : null),
    [data, team],
  );
  // The form this visit was started on (or filed under), not always the newest one.
  const form = useRobotForm({ orgId, live: schema, draftKey: team ? draftKeyFor(team.teamKey) : null, earlier, target: team?.teamKey ?? null });

  // "Draft · 6 answered, not saved yet" on the rows of pits started on this phone.
  const teamKeysOnList = teams.map((candidate) => candidate.teamKey).join(",");
  const drafts = useMemo(() => {
    const marks = new Map<string, string>();
    if (team) return marks;
    for (const teamKey of teamKeysOnList ? teamKeysOnList.split(",") : []) {
      const draft = readScoutDraft(draftKeyFor(teamKey));
      if (!draft) continue;
      const count = answeredCount(draft.payload);
      if (count) marks.set(teamKey, `Draft · ${count} answered, not saved yet`);
    }
    return marks;
  }, [team, teamKeysOnList, draftKeyFor]);

  const entryHref = (extra: Record<string, string> = {}) =>
    `/scout/entry?${new URLSearchParams({ orgId, scoutTab: "pit", ...extra }).toString()}`;
  const homeHref = `/scout?${new URLSearchParams({ orgId }).toString()}`;

  if (viewOnly) return <ScoutViewOnly what="pit visits" homeHref={homeHref} />;

  if (status === "loading" && !data) {
    return (
      <div className="qs-shell" aria-busy="true">
        <p className="sr-only">Loading the pits…</p>
        <Skeleton height={56} />
        <Skeleton height={220} />
      </div>
    );
  }
  if (status === "failed" || !data) {
    const copy = loadFailedCopy(failure ?? (online ? "server" : "offline"));
    return (
      <div className="qs-shell">
        <EmptyState title="Pit scouting didn’t load" description={copy.description}>
          {copy.action === "retry" ? (
            <Button variant="primary" type="button" onClick={retry}>
              Try again
            </Button>
          ) : copy.action === "sign-in" ? (
            <Button as="a" variant="primary" href={signInHref(`${pathname}?${params.toString()}`)}>
              Sign in again
            </Button>
          ) : null}
        </EmptyState>
      </div>
    );
  }
  if (!data.eventKey) {
    return (
      <div className="qs-shell">
        <EmptyState
          badge="Needs setup"
          badgeTone="setup"
          title="Your team hasn’t picked an event yet"
          description={data.canManageSchemas ? "Set the event you are at, and its teams show up here to visit." : "A scouting lead sets the event. Once they do, the pits to visit show up here."}
        >
          {data.canManageSchemas ? (
            <Button as="a" variant="primary" href={hubHref("/competition", "command", orgId)}>
              Set the event
            </Button>
          ) : null}
        </EmptyState>
      </div>
    );
  }
  if (!schema) {
    return (
      <div className="qs-shell">
        <EmptyState
          badge="Needs setup"
          badgeTone="setup"
          title="No pit form yet"
          description={data.canManageSchemas ? "Create the season’s starter forms on the Scout page, or build your own in the form builder." : "A scouting lead publishes the pit form. Ask them, then come back."}
        >
          {data.canManageSchemas ? (
            <Button as="a" variant="primary" href={`/scout/match?orgId=${encodeURIComponent(orgId)}`}>
              Set up the forms
            </Button>
          ) : null}
        </EmptyState>
      </div>
    );
  }

  if (team) {
    return (
      <div className="qs-shell is-live">
        {fromCache ? <SavedCopyBanner failure={failure} cachedAt={cachedAt} onRetry={retry} /> : null}
        {form?.kind === "ready" ? (
          <QuickPitForm
            key={`${team.teamKey}|${form.schema.id}`}
            orgId={orgId}
            data={data}
            form={form}
            teamKey={team.teamKey}
            nickname={team.nickname ?? nicknameFor(team.teamKey)}
            ownTeam={ownTeamNumber !== null && team.teamKey === `frc${ownTeamNumber}`}
            fullFormHref={entryHref({ teamKey: team.teamKey })}
            onChangeTeam={closeTeam}
            onSaved={(saved) => {
              setSavedHere((current) => [...current, saved.teamKey]);
              showReceipt({ clientId: saved.clientId, teamNumber: saved.teamKey.replace(/^frc/, "") });
              closeTeam();
            }}
          />
        ) : (
          <div aria-busy="true">
            <p className="qs-message" role="status">Opening the form this visit was started on…</p>
            <Skeleton height={220} />
          </div>
        )}
      </div>
    );
  }

  const next = teams.find((candidate) => !candidate.visited) ?? null;
  const visitedCount = teams.filter((candidate) => candidate.visited).length;
  const percent = view ? share(visitedCount, view.pit.total) : null;
  const otherVisited = view?.pit.otherVisited ?? [];
  return (
    <div className="qs-shell">
      <header className="qs-head">
        <p className="qs-eyebrow">{data.eventName ?? data.eventKey}</p>
        <h1>Pit scouting</h1>
        {view && view.pit.total > 0 ? (
          <div className="qs-progress" aria-label={`${visitedCount} of ${view.pit.total} pits visited`}>
            <span className="qs-meter" aria-hidden="true">
              <i style={{ width: `${percent ?? 0}%` }} />
            </span>
            <span>
              <strong>{visitedCount}</strong> of {view.pit.total} pits visited
            </span>
          </div>
        ) : null}
        {fromCache ? (
          <SavedCopyBanner failure={failure} cachedAt={cachedAt} onRetry={retry} />
        ) : summary.cachedAt ? (
          <SavedCopyBanner failure={online ? "server" : "offline"} cachedAt={summary.cachedAt} onRetry={summary.reload} />
        ) : null}
      </header>

      {receipt ? (
        <SaveReceipt
          title={`Saved pit visit for ${receipt.teamNumber}`}
          status={receipt.status}
          needsALookHref={`${entryHref()}#needs-a-look`}
          onRetry={retrySend}
        >
          {next ? (
            <Button variant="primary" type="button" className="qs-next" onClick={() => open({ teamKey: next.teamKey, nickname: next.nickname })}>
              Next pit: {next.teamNumber}
              {nameSuffix(next)}
            </Button>
          ) : null}
        </SaveReceipt>
      ) : next ? (
        <Button variant="primary" type="button" className="qs-next qs-next-pit" onClick={() => open({ teamKey: next.teamKey, nickname: next.nickname })}>
          Visit {next.teamNumber}
          {nameSuffix(next)}
        </Button>
      ) : null}

      {summary.status === "loading" && !view ? (
        <Skeleton height={220} />
      ) : (
        <QuickPitPicker teams={teams} drafts={drafts} ownTeamNumber={ownTeamNumber} eventName={data.eventName ?? null} onPick={open} />
      )}

      {otherVisited.length ? (
        <details className="qs-section qs-visited">
          <summary>Not on the event’s list · {otherVisited.length}</summary>
          <p className="qs-fineprint">Pit visits for team numbers this event does not list. They do not count toward the event’s pits.</p>
          <ul className="qs-list">
            {otherVisited.map((other) => (
              <li key={other.teamKey}>
                <button type="button" className="qs-row is-done" onClick={() => open({ teamKey: other.teamKey, nickname: null })}>
                  <span className="qs-dot is-visited" aria-hidden="true" />
                  <span className="qs-row-main">
                    <strong>{other.teamNumber}</strong>
                  </span>
                  <span className="qs-row-end">Visited</span>
                </button>
              </li>
            ))}
          </ul>
        </details>
      ) : null}

      <footer className="qs-foot">
        <a href={`/scout/match?orgId=${encodeURIComponent(orgId)}`}>Match scouting</a>
        <a href={entryHref()}>Full pit form</a>
      </footer>
    </div>
  );
}
