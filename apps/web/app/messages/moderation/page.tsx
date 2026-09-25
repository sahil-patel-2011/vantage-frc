import { Button, EmptyState, PageHeader } from "../../../components/ui";
import { ModerationPanel } from "../moderation-panel";
import { TeamSettingsNav } from "../../../components/team-settings-nav";
import { teamSettingsBreadcrumb } from "../../../lib/nav/team-settings-nav";

export const metadata = {
  title: "Chat moderation",
  description: "Open chat reports for team owners and admins.",
};

export default async function ChatModerationPage({
  searchParams,
}: {
  searchParams: Promise<{ orgId?: string }>;
}) {
  const { orgId } = await searchParams;
  return (
    <main className="module-page moderation-page">
      <PageHeader
        breadcrumbs={teamSettingsBreadcrumb("chat")}
        title="Chat moderation"
        description="Reports from members, for owners and admins to review. Removing a message leaves “Removed by a team admin” in its place."
      >
        {orgId ? <TeamSettingsNav orgId={orgId} current="chat" /> : null}
      </PageHeader>
      {orgId ? (
        <ModerationPanel orgId={orgId} />
      ) : (
        <EmptyState title="Choose your team" description="Choose your team to review chat reports." badge="Needs setup" badgeTone="setup">
          <Button as="a" variant="primary" href="/workspace">
            Choose your team
          </Button>
        </EmptyState>
      )}
    </main>
  );
}
