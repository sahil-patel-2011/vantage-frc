"use client";

import type { WidgetPayload } from "../../../lib/dashboard/snapshot";
import { withOrgHref } from "../../../lib/nav/product-nav";
import { renderOpsWidget } from "./ops-cards";
import { emptyHintFor, WidgetShell as Shell } from "./widget-shell";
import {
  AllianceDeskLive,
  AnnouncementsLive,
  AssemblyManualLive,
  AttendanceLive,
  BatteriesLive,
  BudgetPartsLive,
  CadResourcesLive,
  CalendarTodayLive,
  CodingResourcesLive,
  DutiesLive,
  EventCountdownLive,
  EventReadinessLive,
  HoursLive,
  MatchScheduleLive,
  SponsorFollowupsLive,
  TeamProfileLive,
  WeatherVenueLive,
} from "./extra-cards";

/** Mentor / competition / optional widgets — loaded only when a board uses them. */
export function ExtraWidgetView({
  type,
  payload,
  orgId,
  tbaConfigured,
}: {
  type: string;
  payload?: WidgetPayload;
  orgId: string;
  tbaConfigured?: boolean;
}) {
  const data = payload?.data ?? {};
  const withOrg = (href: string) => withOrgHref(href, orgId || null);
  const hint = emptyHintFor(type);
  const ops = renderOpsWidget({ type, payload, orgId, tbaConfigured });
  if (ops) return ops;

  switch (type) {
    case "duties":
      return (
        <Shell type={type} title="Duties" payload={payload} href={withOrg("/duties")} emptyHint={hint} orgId={orgId}>
          {payload?.status === "live" ? <DutiesLive data={data} /> : null}
        </Shell>
      );
    case "budget_parts":
      return (
        <Shell type={type} title="Budget & parts" payload={payload} href={withOrg("/business?tab=finance")} emptyHint={hint} orgId={orgId}>
          {payload?.status === "live" ? <BudgetPartsLive data={data} /> : null}
        </Shell>
      );
    case "attendance":
      return (
        <Shell type={type} title="Attendance tonight" payload={payload} href={withOrg("/team?tab=attendance")} emptyHint={hint} orgId={orgId}>
          {payload?.status === "live" ? <AttendanceLive data={data} /> : null}
        </Shell>
      );
    case "outreach_hours":
      return (
        <Shell type={type} title="Outreach hours" payload={payload} href={withOrg("/business?tab=evidence")} emptyHint={hint} orgId={orgId}>
          {payload?.status === "live" ? <HoursLive data={data} label="this month" /> : null}
        </Shell>
      );
    case "announcements_ack":
      return (
        <Shell type={type} title="Announcements" payload={payload} href={withOrg("/announcements")} emptyHint={hint} orgId={orgId}>
          {payload?.status === "live" ? <AnnouncementsLive data={data} /> : null}
        </Shell>
      );
    case "event_countdown":
      return (
        <Shell type={type} title="Next event" payload={payload} href={withOrg("/command")} emptyHint={hint} orgId={orgId}>
          {payload?.status === "live" ? <EventCountdownLive data={data} /> : null}
        </Shell>
      );
    case "hours_month":
      return (
        <Shell type={type} title="Hours this month" payload={payload} href={withOrg("/hours")} emptyHint={hint} orgId={orgId}>
          {payload?.status === "live" ? <HoursLive data={data} label="your hours" /> : null}
        </Shell>
      );
    case "calendar_today":
      return (
        <Shell type={type} title="Today" payload={payload} href={withOrg("/team/calendar")} emptyHint={hint} orgId={orgId}>
          {payload?.status === "live" ? <CalendarTodayLive data={data} /> : null}
        </Shell>
      );
    case "cad_resources":
      return (
        <Shell type={type} title="CAD resources" payload={payload} href={withOrg("/cad")} emptyHint={hint} orgId={orgId}>
          {payload?.status === "live" ? <CadResourcesLive data={data} /> : null}
        </Shell>
      );
    case "coding_resources":
      return (
        <Shell type={type} title="Coding resources" payload={payload} href={withOrg("/code")} emptyHint={hint} orgId={orgId}>
          {payload?.status === "live" ? <CodingResourcesLive data={data} /> : null}
        </Shell>
      );
    case "team_profile":
      return (
        <Shell type={type} title="Team profile" payload={payload} href={withOrg("/team/profile")} emptyHint={hint} orgId={orgId}>
          {payload?.status === "live" ? <TeamProfileLive data={data} /> : null}
        </Shell>
      );
    case "alliance_desk":
      return (
        <Shell type={type} title="Alliance desk" payload={payload} href={withOrg("/alliance-selection-desk")} emptyHint={hint} orgId={orgId}>
          {payload?.status === "live" ? <AllianceDeskLive data={data} /> : null}
        </Shell>
      );
    case "match_schedule":
      return (
        <Shell type={type} title="Match schedule" payload={payload} href={withOrg("/schedule")} emptyHint={hint} orgId={orgId}>
          {payload?.status === "live" ? <MatchScheduleLive data={data} /> : null}
        </Shell>
      );
    case "batteries":
      return (
        <Shell type={type} title="Batteries" payload={payload} href={withOrg("/batteries")} emptyHint={hint} orgId={orgId}>
          {payload?.status === "live" ? <BatteriesLive data={data} /> : null}
        </Shell>
      );
    case "assembly_manual":
      return (
        <Shell type={type} title="Assembly manual" payload={payload} href={withOrg("/assembly-manual")} emptyHint={hint} orgId={orgId}>
          {payload?.status === "live" ? <AssemblyManualLive data={data} /> : null}
        </Shell>
      );
    case "sponsor_followups":
      return (
        <Shell type={type} title="Sponsor follow-ups" payload={payload} href={withOrg("/business?tab=sponsors")} emptyHint={hint} orgId={orgId}>
          {payload?.status === "live" ? <SponsorFollowupsLive data={data} /> : null}
        </Shell>
      );
    case "event_readiness":
      return (
        <Shell type={type} title="Event readiness" payload={payload} href={withOrg("/packing")} emptyHint={hint} orgId={orgId}>
          {payload?.status === "live" ? <EventReadinessLive data={data} /> : null}
        </Shell>
      );
    case "weather_venue":
      return (
        <Shell type={type} title="Venue weather" payload={payload} href={withOrg("/command")} emptyHint={hint} orgId={orgId}>
          {payload?.status === "live" ? <WeatherVenueLive data={data} /> : null}
        </Shell>
      );
    default:
      return <Shell type={type} title={hint.title} payload={payload} emptyHint={hint} orgId={orgId} />;
  }
}
