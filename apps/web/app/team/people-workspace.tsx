"use client";

import dynamic from "next/dynamic";
import { Activity, useCallback, useEffect, useState } from "react";
import { TeamRoster } from "../attendance/team-roster";
import { Button, EmptyState, ToolStrip } from "../../components/ui";
import { HubPanelSkeleton } from "../../components/product-hub";
import { useFollowUrl } from "../../lib/nav/use-follow-url";
import { URL_CHANGE_EVENT } from "../../lib/nav/url-change";
import { withOrgHref } from "../../lib/nav/product-nav";
import "./people-workspace.css";

const Attendance = dynamic(() => import("../attendance/attendance-client"), { ssr: false, loading: HubPanelSkeleton });
const Access = dynamic(() => import("./team-admin-client"), { ssr: false, loading: HubPanelSkeleton });
type PeopleView = "members" | "attendance" | "access";
function currentView(): PeopleView {
  const view = new URLSearchParams(window.location.search).get("view");
  return view === "attendance" || view === "access" ? view : "members";
}

/** Roster first; attendance and privileged controls each have one explicit view. */
export default function PeopleWorkspace({ orgId }: { orgId: string }) {
  const [view, setView] = useState<PeopleView>("members");
  const [canManage, setCanManage] = useState<boolean | null>(null);
  const [rosterError, setRosterError] = useState<string | null>(null);
  const [opened, setOpened] = useState({ members: true, attendance: false, access: false });
  const show = useCallback((next: PeopleView) => {
    setView(next);
    setOpened(previous => previous[next] ? previous : { ...previous, [next]: true });
  }, []);
  useEffect(() => show(currentView()), [show]);
  useFollowUrl(() => show(currentView()));
  const choose = (next: PeopleView) => {
    const url = new URL(window.location.href);
    if (next === "members") url.searchParams.delete("view");
    else url.searchParams.set("view", next);
    window.history.pushState({}, "", `${url.pathname}${url.search}${url.hash}`);
    show(next);
    window.dispatchEvent(new Event(URL_CHANGE_EVENT));
  };
  return <section className="people-workspace" aria-label="Team people">
    <div className="people-workspace-tools">
      <ToolStrip presentation="segments" aria-label="People view" value={view} onChange={id => choose(id as PeopleView)} items={[
        { id: "members", label: "Members" }, { id: "attendance", label: "Attendance" },
        ...(canManage || view === "access" ? [{ id: "access", label: "Invites & access" }] : []),
      ]} />
      <Button as="a" variant="ghost" href={withOrgHref("/account/teams", orgId)}>My membership</Button>
    </div>
    <div hidden={view !== "members"}>
      <TeamRoster orgId={orgId} onAccessChange={setCanManage} onError={setRosterError} onManage={() => choose("access")} />
    </div>
    {opened.attendance ? <Activity mode={view === "attendance" ? "visible" : "hidden"}><Attendance embedded showRoster={false} /></Activity> : null}
    {opened.access ? <Activity mode={view === "access" ? "visible" : "hidden"}>
      {rosterError ? <EmptyState title="Could not check team access" description={rosterError}><Button onClick={() => choose("members")}>Return to members to retry</Button></EmptyState> : canManage === null ? <p role="status">Checking team access…</p> : canManage ? <Access key={orgId} orgId={orgId} embedded /> : <EmptyState title="Team access required" description="Ask a team administrator to manage invitations or change access. Your membership is available above." />}
    </Activity> : null}
  </section>;
}
