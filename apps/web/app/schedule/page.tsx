import { loadSchedulePaint } from "../api/schedule/route";
import { withPagePaint } from "../../lib/page-org";
import ScheduleClient from "./schedule-client";
import "./schedule.css";

export const metadata = {
  title: "Match Schedule",
  description: "Every match at the active event — your matches highlighted, results, and scout coverage.",
};

export const dynamic = "force-dynamic";

export default async function SchedulePage({
  searchParams,
}: {
  searchParams: Promise<{ orgId?: string }>;
}) {
  const { orgId } = await searchParams;
  const view = await withPagePaint("/schedule", orgId, ({ client, userId, orgId: resolved }) =>
    loadSchedulePaint(client, userId, resolved),
  );
  return <ScheduleClient initial={view} />;
}
