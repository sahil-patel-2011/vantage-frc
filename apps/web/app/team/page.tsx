import type { Metadata } from "next";
import { loadTeamCalendarView } from "../api/team/calendar/route";
import { hubDocumentTitle } from "../../lib/nav/hub-title";
import { withPagePaint } from "../../lib/page-org";
import TeamHub from "./team-hub";

type Props = { searchParams: Promise<{ tab?: string; orgId?: string }> };

const description = "Calendar, chat, people, tasks, and the playbook.";

/** "Calendar · Team", "Tasks · Team": each tab is its own page in the tab strip. */
export async function generateMetadata({ searchParams }: Props): Promise<Metadata> {
  const { tab } = await searchParams;
  return { title: hubDocumentTitle("team", tab), description };
}

export const dynamic = "force-dynamic";

export default async function TeamPage({ searchParams }: Props) {
  const { tab, orgId } = await searchParams;
  const paint = await withPagePaint("/team", orgId, async ({ client, userId, orgId: resolved }) => {
    const calendarTab = !tab || tab === "calendar";
    if (!resolved || !calendarTab) return { orgId: resolved, calendar: null };
    const member = await client.query<{ role: string }>(
      `SELECT role FROM memberships WHERE user_id = $1::uuid AND org_id = $2::uuid`,
      [userId, resolved],
    );
    const role = member.rows[0]?.role;
    if (!role) return { orgId: resolved, calendar: null };
    return { orgId: resolved, calendar: await loadTeamCalendarView(client, resolved, userId, role) };
  });
  return (
    <TeamHub
      initialTab={tab ?? null}
      initialOrgId={paint?.orgId ?? null}
      initialCalendar={paint?.calendar ?? null}
    />
  );
}
