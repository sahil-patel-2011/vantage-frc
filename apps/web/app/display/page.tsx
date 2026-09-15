import { EmptyState, Button } from "../../components/ui";
import DisplaySetup from "./setup-client";
import "./display.css";

export const metadata = {
  title: "Display Mode",
  description:
    "Build a pit TV board from the official schedule and Strategy predictions. Empty widgets stay blank until real rows exist.",
};

export default async function DisplayPage({
  searchParams,
}: {
  searchParams: Promise<{ orgId?: string }>;
}) {
  const { orgId } = await searchParams;
  if (!orgId) {
    return (
      <main className="module-page display-setup display-gate">
        <EmptyState
          soft
          badge="Needs setup"
          badgeTone="setup"
          title="Choose your team"
          description="Pit TV boards are saved per team. Choose your team before creating a display layout."
        >
          <Button as="a" variant="primary" href="/workspace">
            Choose your team
          </Button>
        </EmptyState>
      </main>
    );
  }
  return <DisplaySetup orgId={orgId} />;
}
