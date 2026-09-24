import GitHubConnectorClient from "./github-client";

export const metadata = {
  title: "GitHub",
  description: "Link your team's robot-code repository.",
};

export default async function GitHubConnectorPage({
  searchParams,
}: {
  searchParams: Promise<{ orgId?: string }>;
}) {
  const { orgId } = await searchParams;
  return <GitHubConnectorClient initialOrgId={orgId?.trim() || null} />;
}
