import PostureClient from "./posture-client";

export default async function TeamPosturePage({
  searchParams,
}: {
  searchParams: Promise<{ orgId?: string }>;
}) {
  const { orgId } = await searchParams;
  if (!orgId) return <main className="content"><h1>Select an organization</h1></main>;
  return <PostureClient orgId={orgId} />;
}
