import { Button, EmptyState, PageHeader } from "../../../components/ui";
import { ModerationPanel } from "../moderation-panel";
import { TeamSettingsNav } from "../../../components/team-settings-nav";
import { teamSettingsBreadcrumb } from "../../../lib/nav/team-settings-nav";

export const metadata = {
  title: "Chat safety",
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
        title="Chat safety"
        description="Reports from members, and the rules for private messages. Removing a message leaves “Removed by a team admin” in its place."
      >
        {orgId ? <TeamSettingsNav orgId={orgId} current="chat" /> : null}
      </PageHeader>
      {/* The DM rules and the child-safety export live with Chat's own settings; this page had
          only the reports, so an owner looking for "who can message whom" did not find them. */}
      {orgId ? (
        <section className="app-card soft-panel" style={{ display: "flex", flexWrap: "wrap", gap: 12, alignItems: "center", justifyContent: "space-between" }}>
          <div>
            <h2 style={{ margin: 0, fontSize: 17 }}>Private message rules</h2>
            <p className="app-muted" style={{ margin: "4px 0 0" }}>
              Who can message whom, the second-adult rule, and the child-safety export.
            </p>
          </div>
          <Button as="a" variant="secondary" href={`/team?tab=messages&settings=1&orgId=${encodeURIComponent(orgId)}`}>
            Open message rules
          </Button>
        </section>
      ) : null}
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
