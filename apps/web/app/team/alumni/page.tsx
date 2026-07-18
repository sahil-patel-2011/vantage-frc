import AlumniClient from "./alumni-client";

export default async function TeamAlumniPage({
  searchParams,
}: {
  searchParams: Promise<{ orgId?: string }>;
}) {
  const { orgId } = await searchParams;
  if (!orgId) return <main className="content"><h1>Select an organization</h1></main>;
  return <AlumniClient orgId={orgId} />;
}
