import { auth } from "@vantage/core";
import { withRls } from "@vantage/db";
import { headers } from "next/headers";
import PairClient from "./pair-client";
import "../cad-setup.css";

// Session-gated server page: never prerendered, so a credential-free build works.
export const dynamic = "force-dynamic";

export const metadata = {
  title: "Pair CAD desktop",
  description: "Approve a pairing code for Onshape or Fusion on a computer you control.",
};

export default async function PairPage({ searchParams }: { searchParams: Promise<{ code?: string }> }) {
  const code = (await searchParams).code ?? "";
  const session = await auth.api.getSession({ headers: await headers() });
  // Proxy already requires a session (or the local E2E fixture cookie). Do not
  // bounce a fixture walk to /signin — that cookie then redirects to /dashboard
  // and the student heading never appears. Empty teams still render Pair this computer.
  if (!session) {
    return <PairClient initialCode={code} organizations={[]} />;
  }
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
  return <PairClient initialCode={code} organizations={orgs} />;
}
