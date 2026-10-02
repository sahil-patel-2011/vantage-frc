import { auth } from "@vantage/core";
import { withRls } from "@vantage/db";
import { headers } from "next/headers";
import { redirect, notFound } from "next/navigation";
import { z } from "zod";
import { workspaceReady, type ProvisioningStatus } from "../../lib/provisioning/model";
import { ProvisioningClient } from "./provisioning-client";
import "./provisioning.css";

export const dynamic = "force-dynamic";
export const metadata = { title: "Setting up your team" };
export default async function TeamSetupPage({ searchParams }: { searchParams: Promise<{ orgId?: string }> }) {
  const { orgId } = await searchParams;
  if (!z.string().uuid().safeParse(orgId).success) redirect("/claim");
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect(`/signin?next=${encodeURIComponent(`/team-setup?orgId=${orgId}`)}`);
  const job = await withRls({ userId: session.user.id, orgId: orgId! }, async (client) =>
    (await client.query<ProvisioningStatus>(`SELECT state,phase,completed_phases AS "completedPhases",error,verified_at::text AS "verifiedAt",retry_after_at::text AS "retryAfterAt"
      FROM team_provisioning_jobs WHERE org_id=$1::uuid`, [orgId])).rows[0]);
  if (!job) {
    // Existing teams can predate the provisioning job. A member opening an old
    // setup link should return to their workspace; unrelated users still get 404.
    const member = await withRls({ userId: session.user.id, orgId: orgId! }, async (client) =>
      (await client.query("SELECT 1 FROM memberships WHERE org_id=$1::uuid AND user_id=$2::uuid", [orgId, session.user.id])).rowCount);
    if (member) redirect(`/dashboard?orgId=${orgId}`);
    notFound();
  }
  if (workspaceReady(job)) redirect(`/dashboard?orgId=${orgId}`);
  return <ProvisioningClient orgId={orgId!} initial={job} />;
}
