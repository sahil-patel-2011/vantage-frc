import { loadCalendarPaint } from "../api/calendar/route";
import { withPagePaint } from "../../lib/page-org";
import CalendarClient from "./calendar-client";
import "./calendar.css";

export const metadata = {
  title: "Season calendar",
  description: "Opt-in FRC season milestone templates — kickoff, stop-build, events, ship deadlines, outreach — with editable markers.",
};

export const dynamic = "force-dynamic";

export default async function CalendarPage({
  searchParams,
}: {
  searchParams: Promise<{ orgId?: string }>;
}) {
  const { orgId } = await searchParams;
  const view = await withPagePaint("/calendar", orgId, ({ client, userId, orgId: resolved }) =>
    loadCalendarPaint(client, userId, resolved),
  );
  return <CalendarClient initial={view} />;
}
