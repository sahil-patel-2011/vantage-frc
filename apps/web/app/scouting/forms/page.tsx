import { EmptyState } from "../../../components/ui";
import FormsClient from "./forms-client";
import "./forms.css";

export const metadata = {
  title: "Scouting form builder · Vantage",
  description: "Build and publish custom match and pit scouting forms for your team.",
};

export default async function ScoutingFormsPage({
  searchParams,
}: {
  searchParams: Promise<{ orgId?: string }>;
}) {
  const { orgId } = await searchParams;
  if (!orgId) {
    return (
      <main className="module-page sfb-page">
        <EmptyState
          badge="Workspace"
          badgeTone="setup"
          title="Select a workspace"
          description="Open the form builder from your team workspace so published schemas stay org-scoped."
        >
          <a className="app-button" href="/workspace">
            Select workspace
          </a>
        </EmptyState>
      </main>
    );
  }
  return <FormsClient orgId={orgId} />;
}
