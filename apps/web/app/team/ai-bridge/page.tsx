import { auth } from "@vantage/core";
import { withRls } from "@vantage/db";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import AiBridgeClient from "./ai-bridge-client";
import "./ai-bridge.css";

// Session-gated server page: never prerendered, so a credential-free build works.
export const dynamic = "force-dynamic";

export const metadata = {
  title: "AI subscription bridge",
  description:
    "Run team AI chat through a member's own Claude Pro/Max or ChatGPT subscription on their machine — $0 API cost, their plan's usage windows apply.",
};

export default async function AiBridgePage({
  searchParams,
}: {
  searchParams: Promise<{ code?: string; orgId?: string }>;
}) {
  const params = await searchParams;
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/signin?next=%2Fteam%2Fai-bridge");
  const orgs = await withRls({ userId: session.user.id }, async (client) =>
    (
      await client.query<{ id: string; name: string; role: string }>(
        `SELECT o.id, o.name, m.role
         FROM memberships m
         JOIN organizations o ON o.id = m.org_id
         WHERE m.user_id = $1::uuid
         ORDER BY o.name`,
        [session.user.id],
      )
    ).rows,
  );
  return (
    <AiBridgeClient
      initialCode={params.code ?? ""}
      initialOrgId={params.orgId ?? null}
      organizations={orgs}
    />
  );
}
