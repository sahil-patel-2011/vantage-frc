import { EmptyState } from "../../../components/ui";
import { alumniShellCopy } from "../../../lib/alumni";
import AlumniClient from "./alumni-client";

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
          <a className="app-button" href="/workspace">
            Select workspace
          </a>
        </EmptyState>
      </main>
    );
  }
  return <AlumniClient orgId={orgId} />;
}
