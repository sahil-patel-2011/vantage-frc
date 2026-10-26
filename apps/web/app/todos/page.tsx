import { computeTodosView } from "../../lib/todos/compute-todos";
import { withPagePaint } from "../../lib/page-org";
import TodosClient from "./todos-client";

export const metadata = {
  title: "Tasks",
};

export const dynamic = "force-dynamic";

export default async function TodosPage({
  searchParams,
}: {
  searchParams: Promise<{ orgId?: string }>;
}) {
  const { orgId } = await searchParams;
  const view = await withPagePaint("/todos", orgId, ({ client, userId, orgId: resolved }) =>
    computeTodosView(client, { userId, requestedOrg: resolved, isolateReads: false }),
  );
  return <TodosClient initial={view} />;
}
