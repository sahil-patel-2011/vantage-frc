import { auth } from "@vantage/core";
import { withRls } from "@vantage/db";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import PairClient, { type PairDevice, type PairOrganization } from "./pair-client";

export const metadata = {
  title: "Pair VS Code · Vantage",
  description:
    "Approve a Vantage VS Code editor pairing code for your team workspace — real devices only, never DEMO pairing metrics.",
};

export default async function EditorPairPage({
  searchParams,
}: {
  searchParams: Promise<{ code?: string; orgId?: string }>;
}) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/signin?next=%2Feditor%2Fpair");

  const params = await searchParams;

  const { orgs, devices } = await withRls({ userId: session.user.id }, async (client) => {
    const orgRows = (
      await client.query<PairOrganization>(
        `SELECT o.id, o.name, m.role
         FROM memberships m
         JOIN organizations o ON o.id = m.org_id
         WHERE m.user_id = $1::uuid
         ORDER BY o.name`,
        [session.user.id],
      )
    ).rows;

    const deviceRows = (
      await client.query<{
        id: string;
        org_id: string;
        org_name: string;
        machine_name: string;
        editor: string;
        last_seen_at: Date | string | null;
        created_at: Date | string;
      }>(
        `SELECT d.id,
                d.org_id,
                o.name AS org_name,
                d.machine_name,
                d.editor,
                d.last_seen_at,
                d.created_at
         FROM editor_devices d
         JOIN organizations o ON o.id = d.org_id
         WHERE d.user_id = $1::uuid
           AND d.status = 'paired'
         ORDER BY d.last_seen_at DESC NULLS LAST, d.created_at DESC
         LIMIT 50`,
        [session.user.id],
      )
    ).rows;

    const mapped: PairDevice[] = deviceRows.map((row) => ({
      id: row.id,
      orgId: row.org_id,
      orgName: row.org_name,
      machineName: row.machine_name,
      editor: row.editor,
      lastSeenAt:
        row.last_seen_at instanceof Date
          ? row.last_seen_at.toISOString()
          : row.last_seen_at
            ? String(row.last_seen_at)
            : null,
      createdAt:
        row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at),
    }));

    return { orgs: orgRows, devices: mapped };
  });

  return (
    <PairClient
      initialCode={params.code ?? ""}
      organizations={orgs}
      devices={devices}
      preferredOrgId={params.orgId ?? null}
    />
  );
}
