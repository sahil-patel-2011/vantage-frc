import { EmptyState, PageHeader, Button } from "../../../components/ui";
import AuthPolicyClient from "./policy-client";
import "../team-admin.css";
import "./security.css";

export const metadata = {
  title: "Team security",
};

export default async function TeamSecurityPage({
  searchParams,
}: {
  searchParams: Promise<{ orgId?: string }>;
}) {
  const { orgId } = await searchParams;
  if (!orgId) {
    return (
      <main className="module-page">
        <PageHeader
          breadcrumbs="Team / Security"
          title="Team security"
          description="Sign-in rules are set per team. Choose your team to open them."
        />
        <EmptyState
          soft
          badge="Team needed"
          badgeTone="setup"
          title="Choose your team"
          description="These rules belong to one team. Choose which one."
        >
          <Button as="a" variant="primary" href="/workspace">
            Choose your team
          </Button>
        </EmptyState>
      </main>
    );
  }
  // What each person can open is set in one place — Team admin → Access — and
  // this page links there instead of repeating the member list.
  return <AuthPolicyClient orgId={orgId} />;
}
