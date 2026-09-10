import { EmptyState, Button } from "../../../components/ui";
import { alumniShellCopy } from "../../../lib/alumni";
import AlumniClient from "./alumni-client";

export const metadata = {
  title: "Alumni · Team",
};

export default async function TeamAlumniPage({
  searchParams,
}: {
  searchParams: Promise<{ orgId?: string }>;
}) {
  const { orgId } = await searchParams;
  if (!orgId) {
    const copy = alumniShellCopy("setup");
    return (
      <main className="content">
        <EmptyState badge={copy.badge} badgeTone="setup" title={copy.title} description={copy.description}>
          <Button as="a" variant="primary" href="/workspace">
            Choose your team
          </Button>
        </EmptyState>
      </main>
    );
  }
  return <AlumniClient orgId={orgId} />;
}
