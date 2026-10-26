import { auth } from "@vantage/core";
import { withRls } from "@vantage/db";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { loadHomePaint } from "../../lib/dashboard/load-home";
import DashboardClient from "./dashboard-client";
import type { DashboardHomeSeed } from "./use-dashboard-home-state";

export const metadata = {
  title: "Home",
};

export const dynamic = "force-dynamic";

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ orgId?: string }>;
}) {
  const { orgId } = await searchParams;
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/signin?next=%2Fdashboard");
  const seed = await withRls({ userId: session.user.id, orgId: orgId || undefined }, (client) =>
    loadHomePaint(client, { orgId: orgId || null, userId: session.user.id }),
  )
    .then(
      (paint): DashboardHomeSeed => ({
        userId: paint.userId,
        orgId: paint.orgId,
        role: paint.role,
        canShareOrg: paint.canShareOrg,
        boards: paint.boards,
        active: paint.active,
        widgets: paint.widgets,
        context: paint.context,
      }),
    )
    .catch(() => null);
  return <DashboardClient initialOrgId={seed?.orgId ?? orgId ?? ""} initialHome={seed} />;
}
