import type { Metadata } from "next";
import { auth } from "@vantage/core";
import { withRls } from "@vantage/db";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { EmptyState, PageHeader, Button } from "../../components/ui";
import { loadPitCommand } from "../api/pit/route";
import {
  PIT_RELATED_INCLUDE,
  pitRelatedLinks,
  pitShellCopy,
} from "../../lib/pit/pit-related";
import "./pit-command.css";
import PitCommandClient from "./pit-command-client";

export const metadata: Metadata = {
  title: "Robot status",
  description:
    "Is the robot ready to play? Open repairs, maintenance, and batteries from what your team logged.",
};

export const dynamic = "force-dynamic";

export default async function PitCommandPage({
  searchParams,
}: {
  searchParams: Promise<{ orgId?: string }>;
}) {
  const { orgId: requested } = await searchParams;
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/signin?next=%2Fpit");
  const paint = await withRls({ userId: session.user.id, orgId: requested || undefined }, async (client) => {
    let orgId = requested || null;
    if (!orgId) {
      const found = await client.query<{ orgId: string }>(
        `SELECT org_id AS "orgId" FROM memberships
          WHERE user_id = $1::uuid
          ORDER BY CASE role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END
          LIMIT 1`,
        [session.user.id],
      );
      orgId = found.rows[0]?.orgId ?? null;
      if (orgId) void client.query(`SELECT set_config('app.org_id', $1, true)`, [orgId]);
    }
    if (!orgId) return null;
    return { orgId, data: await loadPitCommand(client, session, orgId) };
  }).catch(() => null);
  const orgId = paint?.orgId ?? null;
  if (!orgId) {
    const copy = pitShellCopy("setup");
    const related = pitRelatedLinks(null, { include: [...PIT_RELATED_INCLUDE] });
    return (
      <main className="module-page pit-page soft-gate">
        <PageHeader
          breadcrumbs={
            <>
              <a href="/competition">Competition</a>
              {" / Pit / Robot status"}
            </>
          }
          title="Robot status"
          description={copy.description}
        >
          {related.length ? (
            <nav className="product-hub-related pit-related" aria-label="Related pit tools">
              {related.map((link) => (
                <a key={link.id} href={link.href}>{link.label}</a>
              ))}
            </nav>
          ) : null}
        </PageHeader>
        <EmptyState
          soft
          badge={copy.badge}
          badgeTone="setup"
          title={copy.title}
          description={copy.description}
        >
          <Button as="a" variant="primary" href="/workspace">
            Choose your team
          </Button>
        </EmptyState>
      </main>
    );
  }

  return <PitCommandClient orgId={orgId} initial={paint?.data ?? null} />;
}
