"use client";

import { Icon } from "../../components/icon";
import { Button } from "../../components/ui";
import { hubHref } from "../../lib/nav/hubs";
import type { WidgetPayload } from "../../lib/dashboard/snapshot";
import type { DashboardNextAction } from "../../lib/dashboard/dashboard-related";
import type { ScoutDuty } from "./dashboard-home-model";
import { homeActivities, liveCount, scoutingHomeAction } from "./dashboard-overview-model";
import { DashboardHomeTasks } from "./dashboard-home-tasks";
import { DashboardWidgetView } from "./widgets";
import "./dashboard-overview.css";

export function DashboardOverview({ orgId, role, hasEvent, hasForms, eventName, widgets, nextAction, showActivity, showTasks, showNextMatch }: {
  orgId: string; role: string | null; hasEvent: boolean; hasForms: boolean; eventName: unknown;
  widgets: Record<string, WidgetPayload>; nextAction?: DashboardNextAction; showActivity: boolean; showTasks: boolean; showNextMatch: boolean;
}) {
  const duty = widgets.my_day?.status === "live" ? widgets.my_day.data?.scoutDuty as ScoutDuty | undefined : undefined;
  const action = scoutingHomeAction({ orgId, role, hasEvent, hasForms, duty });
  const reports = liveCount(widgets.scouting_coverage, "reports");
  const assignments = liveCount(widgets.scouting_coverage, "assignments");
  const disagreements = liveCount(widgets.scouting_coverage, "openDisagreements");
  const activities = homeActivities(widgets.calendar_today, widgets.my_day);
  const activityKnown = Boolean(widgets.calendar_today && widgets.my_day && widgets.calendar_today.status !== "setup_required" && widgets.my_day.status !== "setup_required");
  const context = typeof eventName === "string" && eventName.trim() ? eventName : hasEvent ? "Active event" : "Practice & preparation";

  return (
    <section className={`dash-overview${showActivity ? "" : " single"}${showTasks ? " with-tasks" : ""}`} aria-label="Team overview" data-testid="dash-overview">
      {showNextMatch ? <div className="dash-home-next-match" data-testid="home-next-match"><DashboardWidgetView
        type="next_match" payload={widgets.next_match} orgId={orgId} canOpenTeamData={role === "owner" || role === "admin"} /></div> : null}
      {showTasks ? <DashboardHomeTasks orgId={orgId} role={role} payload={widgets.team_todos} /> : null}
      <article className="dash-scouting-overview" aria-labelledby="home-scouting-title">
        <header>
          <span className="dash-overview-icon" aria-hidden="true"><Icon name="swords" /></span>
          <div><h2 id="home-scouting-title">Scouting</h2><p>{context}</p></div>
          <a className="dash-overview-open" href={hubHref("/competition", "teams", orgId)} aria-label="Open team analysis"><Icon name="chevron" /></a>
        </header>
        {reports !== null || assignments !== null ? (
          <dl className="dash-scouting-numbers">
            {reports !== null ? <div><dt>Reports collected</dt><dd>{reports}</dd></div> : null}
            {assignments !== null ? <div><dt>Scouting assignments</dt><dd>{assignments}</dd></div> : null}
          </dl>
        ) : <p className="dash-scouting-ready">{hasEvent ? "Record match and pit observations for your team." : "Practice a match or pit report before your next event."}</p>}
        {disagreements !== null && disagreements > 0 && (role === "owner" || role === "admin") ? (
          <a className="dash-overview-attention" href={`${hubHref("/competition", "scouting", orgId)}&scoutTab=conflicts`}>{disagreements} open disagreements <Icon name="chevron" /></a>
        ) : null}
        <footer>
          <Button as="a" variant="primary" href={action.href}>{action.label}<Icon name="chevron" /></Button>
          {hasEvent ? <a href={hubHref("/competition", "picks", orgId)}>Open pick list</a> : null}
        </footer>
        {nextAction ? <div className="dash-scouting-setup" data-testid="dash-context-prompt">
          <p>{nextAction.detail}</p>{nextAction.href !== action.href ? <a href={nextAction.href}>{nextAction.label}<Icon name="chevron" /></a> : null}
        </div> : null}
      </article>
      {showActivity ? <article className="dash-activity-overview" aria-labelledby="home-activity-title">
        <header><h2 id="home-activity-title">Coming up</h2><a href={hubHref("/team", "calendar", orgId)}>Calendar <Icon name="chevron" /></a></header>
        {activities.length ? <ol>{activities.map(item => {
          const at = new Date(item.startsAt);
          return <li key={`${item.duty}:${item.startsAt}:${item.title}`}>
            <time dateTime={item.startsAt}><strong>{at.toLocaleDateString(undefined, { day: "numeric" })}</strong><span>{at.toLocaleDateString(undefined, { month: "short" })}</span></time>
            <a href={hubHref("/team", item.duty ? "duties" : "calendar", orgId)}><strong>{item.title}</strong><small>{item.ongoing ? "Happening now · " : ""}{item.duty ? "Your duty · " : ""}{at.toLocaleString(undefined, { weekday: "short", hour: "numeric", minute: "2-digit" })}</small></a>
          </li>;
        })}</ol> : <p className="dash-activity-empty">{activityKnown ? "Nothing scheduled this week. Plan your next practice in Calendar." : "Schedule unavailable. Open Calendar to try again."}</p>}
      </article> : null}
    </section>
  );
}
