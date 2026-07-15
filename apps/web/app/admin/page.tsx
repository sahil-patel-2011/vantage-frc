import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@vantage/core";
import { withRls } from "@vantage/db";
import AdminClient from "./admin-client";

export const dynamic = "force-dynamic";

export default async function AdminPage() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/");
  const allowed = await withRls({ userId: session.user.id }, async (client) => {
    const result = await client.query<{ allowed: boolean }>("SELECT is_platform_admin() AS allowed");
    return result.rows[0]?.allowed === true;
  });
  if (!allowed) redirect("/");

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">VANTAGE / ADMIN</div>
        <nav><a className="active" href="/admin">Overview</a><a href="/admin">Organizations</a><a href="/admin">Usage</a><a href="/admin">Audit log</a></nav>
      </aside>
      <AdminClient />
    </div>
  );
}
