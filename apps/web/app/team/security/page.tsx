import CapabilitiesClient from "./capabilities-client";
import AuthPolicyClient from "./policy-client";

export default async function TeamSecurityPage({
  searchParams,
}: {
  searchParams: Promise<{ orgId?: string }>;
}) {
  const { orgId } = await searchParams;
  if (!orgId) return <main className="content"><h1>Select an organization</h1></main>;
  return (
    <>
      <AuthPolicyClient orgId={orgId} />
      <main className="intel-app" style={{ paddingTop: 0 }}>
        <CapabilitiesClient orgId={orgId} />
      </main>
    </>
  );
}
