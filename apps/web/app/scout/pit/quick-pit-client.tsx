"use client";

import { usePathname, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { Button, EmptyState, Skeleton } from "../../../components/ui";
import { syncOutbox } from "../../../lib/scout-offline";
import { useOnline } from "../../../lib/offline/use-online";
import { hubHref } from "../../../lib/nav/hubs";
import { useScoutingSummary } from "../../../lib/scouting/use-scouting-summary";
import { share } from "../../../lib/scouting/lead-summary";
import { replaceQuery, useScoutingBootstrap } from "../use-scouting-bootstrap";
import { QuickPitForm } from "./quick-pit-form";
import { QuickPitPicker } from "./quick-pit-picker";

type Receipt = { teamNumber: string; sync: "sending" | "sent" | "waiting" | "failed" };

/** " · Citrus Circuits", or nothing when the name is only the placeholder "Team 1678". */
function nameSuffix(team: { teamNumber: number; nickname: string | null }): string {
  const name = team.nickname?.trim() ?? "";
  return name && name.toLowerCase() !== `team ${team.teamNumber}` ? ` · ${name}` : "";
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
  const { data, status, fromCache, retry } = useScoutingBootstrap(orgId, requestedEventKey);
  const summary = useScoutingSummary(orgId);
  const [team, setTeam] = useState<{ teamKey: string; nickname: string | null } | null>(() => {
    const teamKey = params.get("teamKey");
    return teamKey && /^frc\d+$/.test(teamKey) ? { teamKey, nickname: null } : null;
  });
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  // Saved on this phone a moment ago: visited, even before the outbox or the server says so.
  const [savedHere, setSavedHere] = useState<string[]>([]);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const view = summary.view?.status === "ready" ? summary.view : null;
  const teams = (view?.pit.teams ?? []).map((candidate) =>
    savedHere.includes(candidate.teamKey) ? { ...candidate, visited: true } : candidate,
  );
  const nicknameFor = (teamKey: string) => teams.find((candidate) => candidate.teamKey === teamKey)?.nickname ?? null;

  const open = useCallback(
    (next: { teamKey: string; nickname: string | null } | null) => {
      setTeam(next);
      if (next) setReceipt(null);
      replaceQuery(pathname, { teamKey: next?.teamKey ?? null });
    },
    [pathname],
  );

  async function sendNow() {
    if (!navigator.onLine) {
      setReceipt((current) => (current ? { ...current, sync: "waiting" } : current));
      return;
    }
    try {
      const result = await syncOutbox(orgId, { maxAttempts: 3 });
      if (!mounted.current) return;
      setReceipt((current) => (current ? { ...current, sync: result.quarantined > 0 ? "failed" : "sent" } : current));
      summary.reload();
    } catch {
      if (mounted.current) setReceipt((current) => (current ? { ...current, sync: "waiting" } : current));
    }
  }

  useEffect(() => {
    if (online && receipt?.sync === "waiting") void sendNow();
  }, [online]);

  const schema = data?.schemas.find((candidate) => candidate.type === "pit") ?? null;
  const entryHref = (extra: Record<string, string> = {}) =>
    `/scout/entry?${new URLSearchParams({ orgId, scoutTab: "pit", ...extra }).toString()}`;

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
    return (
      <div className="qs-shell">
        <EmptyState
          title="Pit scouting didn’t load"
          description={online ? "Your team’s event could not be loaded. Try again in a moment." : "This phone has no saved copy of your event yet. Open Scouting once with a signal, then it works offline."}
        >
          <Button variant="primary" type="button" onClick={retry}>
            Try again
          </Button>
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
        {fromCache ? <p className="qs-offline">Offline · using this phone’s saved copy. Saves send when the signal is back.</p> : null}
        <QuickPitForm
          key={`${team.teamKey}|${schema.id}`}
          orgId={orgId}
          data={data}
          schema={schema}
          teamKey={team.teamKey}
          nickname={team.nickname ?? nicknameFor(team.teamKey)}
          fullFormHref={entryHref({ teamKey: team.teamKey })}
          onChangeTeam={() => open(null)}
          onSaved={(teamKey) => {
            setSavedHere((current) => [...current, teamKey]);
            open(null);
            setReceipt({ teamNumber: teamKey.replace(/^frc/, ""), sync: navigator.onLine ? "sending" : "waiting" });
            void sendNow();
          }}
        />
      </div>
    );
  }

  const next = teams.find((candidate) => !candidate.visited) ?? null;
  const visitedCount = teams.filter((candidate) => candidate.visited).length;
  const percent = view ? share(visitedCount, view.pit.total) : null;
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
        {fromCache || summary.cachedAt ? <p className="qs-offline">Offline · using this phone’s saved copy.</p> : null}
      </header>

      {receipt ? (
        <section className="qs-receipt" role="status" aria-live="polite">
          <span className="qs-receipt-check" aria-hidden="true">✓</span>
          <div>
            <strong>Saved pit visit for {receipt.teamNumber}</strong>
            <span>
              {receipt.sync === "sent"
                ? "Sent to your team."
                : receipt.sync === "sending"
                  ? "Sending to your team…"
                  : receipt.sync === "failed"
                    ? "Saved here, but your team’s server refused it. Open the full form to see why."
                    : "Saved on this phone. It sends itself when the signal is back."}
            </span>
          </div>
          {next ? (
            <Button variant="primary" type="button" className="qs-next" onClick={() => open({ teamKey: next.teamKey, nickname: next.nickname })}>
              Next pit: {next.teamNumber}
              {nameSuffix(next)}
            </Button>
          ) : null}
        </section>
      ) : next ? (
        <Button variant="primary" type="button" className="qs-next qs-next-pit" onClick={() => open({ teamKey: next.teamKey, nickname: next.nickname })}>
          Visit {next.teamNumber}
          {nameSuffix(next)}
        </Button>
      ) : null}

      {summary.status === "loading" && !view ? <Skeleton height={220} /> : <QuickPitPicker teams={teams} onPick={open} />}

      <footer className="qs-foot">
        <a href={`/scout/match?orgId=${encodeURIComponent(orgId)}`}>Match scouting</a>
        <a href={entryHref()}>Full pit form</a>
      </footer>
    </div>
  );
}
