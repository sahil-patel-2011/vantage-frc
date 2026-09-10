import GrantsClient from "./grants-client";
import { EmptyState } from "../../../components/ui";

export const metadata = {
  title: "Grants",
};

export default async function GrantsPage({
  searchParams,
}: {
  searchParams: Promise<{ orgId?: string }>;
}) {
  const { orgId } = await searchParams;
  if (!orgId) {
    return (
      <main className="module-page gwe-page content soft-gate">
        <header className="app-page-header">
          <div>
            <span className="breadcrumbs">Business / Grants</span>
            <h1>Grant writing</h1>
          </div>
        </header>
        <EmptyState
          soft
          badge="Setup required"
          badgeTone="setup"
          title="Select a team"
          description="Grant narratives belong to one team. Choose a team to open the writing workbench — award amounts stay blank until you record them."
        >
          <a className="app-button" href="/workspace">
            Choose your team
          </a>
        </EmptyState>
      </main>
    );
  }
  return <GrantsClient orgId={orgId} />;
}
