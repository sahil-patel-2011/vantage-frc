import { auth } from "@vantage/core";
import { withRls } from "@vantage/db";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { loadEventDayCommand } from "../../lib/command/load-command";
import CommandClient from "./command-client";
import "./command.css";

export const metadata = {
  title: "Event day",
};

export const dynamic = "force-dynamic";

export default async function CommandPage({
  searchParams,
}: {
  searchParams: Promise<{ orgId?: string }>;
}) {
  const { orgId: requested } = await searchParams;
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/signin?next=%2Fcommand");
  const paint = await withRls({ userId: session.user.id, orgId: requested || undefined }, async (client) => {
    let resolved = requested || null;
    if (!resolved) {
      const found = await client.query<{ orgId: string }>(
        `SELECT org_id AS "orgId" FROM memberships
          WHERE user_id = $1::uuid
          ORDER BY CASE role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END
          LIMIT 1`,
        [session.user.id],
      );
      resolved = found.rows[0]?.orgId ?? null;
      if (resolved) void client.query(`SELECT set_config('app.org_id', $1, true)`, [resolved]);
    }
    if (!resolved) return null;
    return { orgId: resolved, snap: await loadEventDayCommand(client, { orgId: resolved, userId: session.user.id }) };
  }).catch(() => null);
  return <CommandClient initialOrgId={paint?.orgId ?? requested ?? ""} initialSnap={paint?.snap ?? null} />;
}
