import DashboardClient from "./dashboard-client";

export const metadata = {
  title: "Home",
};

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ orgId?: string }>;
}) {
  const { orgId } = await searchParams;
  return <DashboardClient initialOrgId={orgId ?? ""} />;
}
