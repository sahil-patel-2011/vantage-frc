import type { Metadata } from "next";
import { loadMessagesHome } from "../api/messages/route";
import { loadTeamCalendarView } from "../api/team/calendar/route";
import { parseComposerLinkFromSearch } from "../../lib/messages/object-links";
import { hubDocumentTitle } from "../../lib/nav/hub-title";
import { withPagePaint } from "../../lib/page-org";
import { computeTodosView } from "../../lib/todos/compute-todos";
import MessagesClient from "../messages/messages-client";
import TodosClient from "../todos/todos-client";
import TeamHub from "./team-hub";

type Props = {
  searchParams: Promise<{
    tab?: string;
    orgId?: string;
    conversationId?: string;
    linkType?: string;
    linkId?: string;
    linkLabel?: string;
    todoId?: string;
  }>;
};

const description = "Calendar, chat, people, tasks, and the playbook.";

/** "Calendar · Team", "Tasks · Team": each tab is its own page in the tab strip. */
export async function generateMetadata({ searchParams }: Props): Promise<Metadata> {
  const { tab } = await searchParams;
  return { title: hubDocumentTitle("team", tab), description };
}

export const dynamic = "force-dynamic";

export default async function TeamPage({ searchParams }: Props) {
  const params = await searchParams;
  const { tab, orgId } = params;
  const nextPath = tab ? `/team?tab=${tab}` : "/team";
  const paint = await withPagePaint(nextPath, orgId, async ({ client, userId, orgId: resolved }) => {
    if (!resolved) return { orgId: resolved, calendar: null, messages: null, todos: null };
    if (!tab || tab === "calendar") {
      const member = await client.query<{ role: string }>(
        `SELECT role FROM memberships WHERE user_id = $1::uuid AND org_id = $2::uuid`,
        [userId, resolved],
      );
      const role = member.rows[0]?.role;
      if (!role) return { orgId: resolved, calendar: null, messages: null, todos: null };
      return {
        orgId: resolved,
        calendar: await loadTeamCalendarView(client, resolved, userId, role),
        messages: null,
        todos: null,
      };
    }
    if (tab === "messages") {
      return {
        orgId: resolved,
        calendar: null,
        messages: await loadMessagesHome(client, resolved, userId),
        todos: null,
      };
    }
    if (tab === "todos") {
      return {
        orgId: resolved,
        calendar: null,
        messages: null,
        todos: await computeTodosView(client, {
          userId,
          requestedOrg: resolved,
          focusTodoId: params.todoId ?? null,
          isolateReads: false,
        }),
      };
    }
    return { orgId: resolved, calendar: null, messages: null, todos: null };
  });
  const resolvedOrg = paint?.orgId ?? null;
  const initialObjectLink =
    tab === "messages" && resolvedOrg
      ? parseComposerLinkFromSearch(new URLSearchParams(params as Record<string, string>), resolvedOrg)
      : null;
  const messagesPanel =
    tab === "messages" && resolvedOrg && paint?.messages ? (
      <MessagesClient
        orgId={resolvedOrg}
        embedded
        initialConversationId={params.conversationId ?? null}
        initialObjectLink={initialObjectLink}
        initialInbox={paint.messages}
      />
    ) : null;
  const todosPanel = tab === "todos" && paint?.todos ? <TodosClient embedded initial={paint.todos} /> : null;
  return (
    <TeamHub
      initialTab={tab ?? null}
      initialOrgId={resolvedOrg}
      initialCalendar={paint?.calendar ?? null}
      messagesPanel={messagesPanel}
      todosPanel={todosPanel}
    />
  );
}
