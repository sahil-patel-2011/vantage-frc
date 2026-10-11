"use client";

import { usePathname, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button, EmptyState, Skeleton } from "../../../components/ui";
import { readActiveScoutDraft } from "../../../lib/scouting/draft-autosave";
import { nextScoutTarget, scoutContext, describeScoutContext, type NextScoutTarget } from "../../../lib/scouting/scout-context";
import { syncOutbox } from "../../../lib/scout-offline";
import { useOnline } from "../../../lib/offline/use-online";
import { FEATURE_API_TIMEOUT_MS } from "../../../lib/nav/resolve-org";
import { hubHref } from "../../../lib/nav/hubs";
import { myReports, type Bootstrap } from "../../scouting/scouting-model";
import { QuickScoutMatch, type QuickSaved } from "./quick-scout-match";
import { QuickScoutPicker, type QuickTarget } from "./quick-scout-picker";
import { replaceQuery, useScoutingBootstrap } from "../use-scouting-bootstrap";

type Receipt = {
  label: string;
  next: NextScoutTarget | null;
  sync: "sending" | "sent" | "waiting" | "failed";
};

/**
 * Quick scout: pick a robot, watch it, save. Loads the same scouting data as the full
 * Scout form (and its copy on this phone with no signal), and hands each robot to the
 * match screen. The robot being scouted lives in the address, so a reload or a closed
 * tab comes back to the same robot with its draft.
 */
export function QuickScoutClient({ orgId }: { orgId: string }) {
  const params = useSearchParams();
  const pathname = usePathname() ?? "/scout/match";
  const requestedEventKey = params.get("eventKey");
  // The robot lives in the address so a reload comes back to it, but it changes with a
  // shallow history update, never a router navigation: at a venue with no signal a
  // navigation would ask the server for the page and fail.
  const [target, setTarget] = useState<QuickTarget | null>(() => {
    const matchKey = params.get("matchKey");
    const teamKey = params.get("teamKey");
    return matchKey && teamKey ? { matchKey, teamKey } : null;
  });
  const matchKey = target?.matchKey ?? "";
  const teamKey = target?.teamKey ?? "";
  const online = useOnline();
  const { data, status, fromCache, retry, replace } = useScoutingBootstrap(orgId, requestedEventKey);
  const [savedHere, setSavedHere] = useState<QuickTarget[]>([]);
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const [creatingForms, setCreatingForms] = useState(false);
  const [formsNote, setFormsNote] = useState<string | null>(null);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const show = useCallback(
    (next: QuickTarget | null) => {
      setTarget(next);
      replaceQuery(pathname, { matchKey: next?.matchKey ?? null, teamKey: next?.teamKey ?? null });
    },
    [pathname],
  );
  const open = useCallback(
    (next: QuickTarget) => {
      setReceipt(null);
      show(next);
    },
    [show],
  );
  const closeRobot = useCallback(() => show(null), [show]);

  const schema = useMemo(() => data?.schemas.find((candidate) => candidate.type === "match") ?? null, [data]);

  const resume = useMemo(() => {
    if (!data?.eventKey || !data.scoutIdentity?.userId) return null;
    const draft = readActiveScoutDraft({ userId: data.scoutIdentity.userId, orgId, eventKey: data.eventKey });
    if (!draft || draft.type !== "match" || !draft.matchKey) return null;
    const context = scoutContext({ matches: data.matches ?? [], matchKey: draft.matchKey, teamKey: draft.teamKey });
    return { matchKey: draft.matchKey, teamKey: draft.teamKey, label: context ? describeScoutContext(context) : draft.teamKey };
    // Re-read when the robot changes: saving clears the draft it pointed at.
  }, [data, orgId, matchKey, teamKey]);

  async function sendNow() {
    if (!navigator.onLine) {
      setReceipt((current) => (current ? { ...current, sync: "waiting" } : current));
      return;
    }
    try {
      const result = await syncOutbox(orgId, { maxAttempts: 3 });
      if (!mounted.current) return;
      setReceipt((current) => (current ? { ...current, sync: result.quarantined > 0 ? "failed" : "sent" } : current));
    } catch {
      if (mounted.current) setReceipt((current) => (current ? { ...current, sync: "waiting" } : current));
    }
  }

  function saved(entry: QuickSaved) {
    if (!data) return;
    const done = [...savedHere.filter((row) => !(row.matchKey === entry.matchKey && row.teamKey === entry.teamKey)), { matchKey: entry.matchKey, teamKey: entry.teamKey }];
    setSavedHere(done);
    const mine = myReports(data);
    const next = nextScoutTarget({
      matches: data.matches ?? [],
      assignments: data.assignments ?? [],
      savedMatchKey: entry.matchKey,
      savedTeamKey: entry.teamKey,
      done: (nextMatch, nextTeam) =>
        done.some((row) => row.matchKey === nextMatch && row.teamKey === nextTeam) ||
        mine.some((row) => row.type === "match" && row.matchKey === nextMatch && row.teamKey === nextTeam),
    });
    const context = scoutContext({ matches: data.matches ?? [], matchKey: entry.matchKey, teamKey: entry.teamKey });
    setReceipt({
      label: context ? describeScoutContext(context) : entry.teamKey,
      next: next?.teamKey ? next : null,
      sync: navigator.onLine ? "sending" : "waiting",
    });
    show(null);
    void sendNow();
  }

  // Back online with a receipt still waiting: send it now.
  useEffect(() => {
    if (online && receipt?.sync === "waiting") void sendNow();
  }, [online]);

  async function createStarterForms() {
    setCreatingForms(true);
    setFormsNote(null);
    try {
      const response = await fetch("/api/scouting/schemas", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ orgId, action: "ensure_defaults", ...(requestedEventKey ? { eventKey: requestedEventKey } : {}) }),
        signal: AbortSignal.timeout(FEATURE_API_TIMEOUT_MS),
      });
      const body = (await response.json().catch(() => null)) as (Bootstrap & { error?: string }) | null;
      if (!response.ok || !body || !Array.isArray(body.schemas)) throw new Error(body?.error ?? "The starter form could not be created.");
      replace(body);
    } catch (error) {
      setFormsNote(error instanceof Error ? error.message : "The starter form could not be created. Try again.");
    } finally {
      setCreatingForms(false);
    }
  }

  const entryHref = (extra: Record<string, string> = {}) =>
    `/scout/entry?${new URLSearchParams({ orgId, ...extra }).toString()}`;

  if (status === "loading" && !data) {
    return (
      <div className="qs-shell" aria-busy="true">
        <p className="sr-only">Loading your matches…</p>
        <Skeleton height={56} />
        <Skeleton height={140} />
        <Skeleton height={220} />
      </div>
    );
  }

  if (status === "failed" || !data) {
    return (
      <div className="qs-shell">
        <EmptyState
          title="Scouting didn’t load"
          description={online ? "Your team’s matches could not be loaded. Try again in a moment." : "This phone has no saved copy of your event yet. Open Scouting once with a signal, then it works offline."}
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
          description={data.canManageSchemas ? "Set the event you are at, and its match schedule shows up here." : "A scouting lead sets the event. Once they do, your matches show up here."}
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
          title="No match form yet"
          description={data.canManageSchemas ? "Start with the season’s starter form. You can change any question later in the form builder." : "A scouting lead publishes the match form. Ask them, then come back."}
        >
          {data.canManageSchemas ? (
            <Button variant="primary" type="button" disabled={creatingForms || !online} onClick={() => void createStarterForms()}>
              {creatingForms ? "Creating…" : "Use the starter form"}
            </Button>
          ) : null}
        </EmptyState>
        {formsNote ? <p className="qs-message" role="alert">{formsNote}</p> : null}
      </div>
    );
  }

  if (matchKey && teamKey) {
    return (
      <div className="qs-shell is-live">
        {fromCache ? <p className="qs-offline">Offline · using this phone’s saved copy. Saves send when the signal is back.</p> : null}
        <QuickScoutMatch
          key={`${matchKey}|${teamKey}|${schema.id}`}
          orgId={orgId}
          data={data}
          schema={schema}
          matchKey={matchKey}
          teamKey={teamKey}
          fullFormHref={entryHref({ matchKey, teamKey })}
          onSaved={saved}
          onChangeRobot={closeRobot}
        />
      </div>
    );
  }

  return (
    <div className="qs-shell">
      <header className="qs-head">
        <p className="qs-eyebrow">{data.eventName ?? data.eventKey}</p>
        <h1>Scout a match</h1>
        {fromCache ? <p className="qs-offline">Offline · using this phone’s saved copy.</p> : null}
      </header>

      {receipt ? (
        <section className="qs-receipt" role="status" aria-live="polite">
          <span className="qs-receipt-check" aria-hidden="true">✓</span>
          <div>
            <strong>Saved {receipt.label}</strong>
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
          {receipt.next ? (
            <Button variant="primary" type="button" className="qs-next" onClick={() => open({ matchKey: receipt.next!.matchKey, teamKey: receipt.next!.teamKey })}>
              Next: {receipt.next.teamKey.replace(/^frc/, "")} · {receipt.next.matchLabel}
              {receipt.next.stationLabel ? ` · ${receipt.next.stationLabel}` : ""}
            </Button>
          ) : null}
        </section>
      ) : null}

      <QuickScoutPicker data={data} savedHere={savedHere} resume={receipt ? null : resume} onPick={open} />

      <footer className="qs-foot">
        <a href={entryHref({ scoutTab: "pit" })}>Pit scouting</a>
        <a href={entryHref()}>Full scouting form</a>
      </footer>
    </div>
  );
}
