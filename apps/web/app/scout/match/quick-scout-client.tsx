"use client";

import { usePathname, useSearchParams } from "next/navigation";
import { useCallback, useMemo, useState } from "react";
import { Button, EmptyState, Skeleton } from "../../../components/ui";
import { readActiveScoutDraft, scoutDraftStorageKey } from "../../../lib/scouting/draft-autosave";
import { nextScoutTarget, scoutContext, describeScoutContext, type NextScoutTarget } from "../../../lib/scouting/scout-context";
import { loadFailedCopy } from "../../../lib/scouting/load-state";
import { useOnline } from "../../../lib/offline/use-online";
import { useViewOnly } from "../../../lib/nav/use-view-only";
import { FEATURE_API_TIMEOUT_MS } from "../../../lib/nav/resolve-org";
import { hubHref } from "../../../lib/nav/hubs";
import { signInHref } from "../../../lib/ui/load-failure";
import { myReports, type Bootstrap } from "../../scouting/scouting-model";
import { QuickScoutMatch, type QuickSaved } from "./quick-scout-match";
import { QuickScoutPicker, type QuickTarget } from "./quick-scout-picker";
import { closeQuery, pushQuery, useQueryPopState, useScoutingBootstrap } from "../use-scouting-bootstrap";
import { SaveReceipt } from "../save-receipt";
import { SavedCopyBanner } from "../saved-copy-banner";
import { ScoutViewOnly } from "../scout-view-only";
import { useRobotForm } from "../use-robot-form";
import { useSaveReceipt } from "../use-save-receipt";

/**
 * Quick scout: pick a robot, watch it, save. Loads the same scouting data as the full
 * Scout form (and its copy on this phone with no signal), and hands each robot to the
 * match screen. The robot being scouted lives in the address, so a reload or a closed
 * tab comes back to the same robot with its draft, and the phone's Back button returns
 * from a robot to the list.
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
  // View only (0715): no form to fill. The server refuses their reports anyway.
  const viewOnly = useViewOnly(orgId);
  const { data, status, fromCache, cachedAt, failure, retry, replace } = useScoutingBootstrap(orgId, requestedEventKey);
  const [savedHere, setSavedHere] = useState<QuickTarget[]>([]);
  const { receipt, show: showReceipt, retry: retrySend, clear: clearReceipt } = useSaveReceipt<{ label: string; next: NextScoutTarget | null }>(orgId);
  const [creatingForms, setCreatingForms] = useState(false);
  const [formsNote, setFormsNote] = useState<string | null>(null);

  const open = useCallback(
    (next: QuickTarget) => {
      clearReceipt();
      setTarget(next);
      pushQuery(pathname, { matchKey: next.matchKey, teamKey: next.teamKey });
    },
    [pathname, clearReceipt],
  );
  const closeRobot = useCallback(() => {
    setTarget(null);
    closeQuery(pathname, { matchKey: null, teamKey: null });
  }, [pathname]);
  // The phone's Back (and Forward) between the list and a robot.
  useQueryPopState(
    useCallback((query: URLSearchParams) => {
      const nextMatch = query.get("matchKey");
      const nextTeam = query.get("teamKey");
      setTarget(nextMatch && nextTeam ? { matchKey: nextMatch, teamKey: nextTeam } : null);
    }, []),
  );

  const schema = useMemo(() => data?.schemas.find((candidate) => candidate.type === "match") ?? null, [data]);
  const ownTeamKey = data?.teamNumber ? `frc${data.teamNumber}` : null;
  const draftKey = scoutDraftStorageKey({
    userId: data?.scoutIdentity?.userId,
    orgId,
    eventKey: data?.eventKey ?? "",
    entryType: "match",
    matchKey,
    teamKey,
  });
  const earlier = useMemo(
    () =>
      target && data
        ? myReports(data).find((entry) => entry.type === "match" && entry.matchKey === target.matchKey && entry.teamKey === target.teamKey) ?? null
        : null,
    [data, target],
  );
  // The form this robot was started on (or filed under), not always the newest one.
  const form = useRobotForm({ orgId, live: schema, draftKey, earlier, target: target ? `${matchKey}|${teamKey}` : null });

  const resume = useMemo(() => {
    if (!data?.eventKey || !data.scoutIdentity?.userId) return null;
    const draft = readActiveScoutDraft({ userId: data.scoutIdentity.userId, orgId, eventKey: data.eventKey });
    if (!draft || draft.type !== "match" || !draft.matchKey) return null;
    const context = scoutContext({ matches: data.matches ?? [], matchKey: draft.matchKey, teamKey: draft.teamKey });
    return { matchKey: draft.matchKey, teamKey: draft.teamKey, label: context ? describeScoutContext(context) : draft.teamKey };
    // Re-read when the robot changes: saving clears the draft it pointed at.
  }, [data, orgId, matchKey, teamKey]);

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
      ownTeamKey,
      done: (nextMatch, nextTeam) =>
        done.some((row) => row.matchKey === nextMatch && row.teamKey === nextTeam) ||
        mine.some((row) => row.type === "match" && row.matchKey === nextMatch && row.teamKey === nextTeam),
    });
    const context = scoutContext({ matches: data.matches ?? [], matchKey: entry.matchKey, teamKey: entry.teamKey });
    showReceipt({
      clientId: entry.clientId,
      label: context ? describeScoutContext(context) : entry.teamKey,
      next: next?.teamKey ? next : null,
    });
    closeRobot();
  }

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
  const homeHref = `/scout?${new URLSearchParams({ orgId }).toString()}`;

  if (viewOnly) return <ScoutViewOnly what="match reports" homeHref={homeHref} />;

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
    const copy = loadFailedCopy(failure ?? (online ? "server" : "offline"));
    return (
      <div className="qs-shell">
        <EmptyState title="Scouting didn’t load" description={copy.description}>
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
        {fromCache ? <SavedCopyBanner failure={failure} cachedAt={cachedAt} onRetry={retry} /> : null}
        {form?.kind === "ready" ? (
          <QuickScoutMatch
            key={`${matchKey}|${teamKey}|${form.schema.id}`}
            orgId={orgId}
            data={data}
            form={form}
            matchKey={matchKey}
            teamKey={teamKey}
            ownTeamKey={ownTeamKey}
            fullFormHref={entryHref({ matchKey, teamKey })}
            onSaved={saved}
            onChangeRobot={closeRobot}
          />
        ) : (
          <div aria-busy="true">
            <p className="qs-message" role="status">Opening the form this robot was started on…</p>
            <Skeleton height={220} />
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="qs-shell">
      <header className="qs-head">
        <p className="qs-eyebrow">{data.eventName ?? data.eventKey}</p>
        <h1>Scout a match</h1>
        {fromCache ? <SavedCopyBanner failure={failure} cachedAt={cachedAt} onRetry={retry} /> : null}
      </header>

      {receipt ? (
        <SaveReceipt
          title={`Saved ${receipt.label}`}
          status={receipt.status}
          needsALookHref={`${entryHref()}#needs-a-look`}
          onRetry={retrySend}
        >
          {receipt.next ? (
            <Button variant="primary" type="button" className="qs-next" onClick={() => open({ matchKey: receipt.next!.matchKey, teamKey: receipt.next!.teamKey })}>
              Next: {receipt.next.teamKey.replace(/^frc/, "")} · {receipt.next.matchLabel}
              {receipt.next.stationLabel ? ` · ${receipt.next.stationLabel}` : ""}
            </Button>
          ) : null}
        </SaveReceipt>
      ) : null}

      <QuickScoutPicker
        key={receipt?.next?.matchKey ?? "start"}
        data={data}
        savedHere={savedHere}
        resume={receipt ? null : resume}
        focusMatchKey={receipt?.next?.matchKey ?? null}
        ownTeamKey={ownTeamKey}
        onPick={open}
      />

      <footer className="qs-foot">
        <a href={entryHref({ scoutTab: "pit" })}>Pit scouting</a>
        <a href={entryHref()}>Full scouting form</a>
      </footer>
    </div>
  );
}
