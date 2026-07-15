import TeamAdminClient from "./team-admin-client";

export default async function TeamPage({
  searchParams,
}: {
  searchParams: Promise<{ orgId?: string }>;
}) {
  const { orgId } = await searchParams;
  if (!orgId) return <main className="content"><h1>Select an organization</h1></main>;
  return <TeamAdminClient orgId={orgId} />;
}
