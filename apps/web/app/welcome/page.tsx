import { auth } from "@vantage/core";
import { roleHint, roleLabel } from "@vantage/core/role-words";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { Icon, type IconName } from "../../components/icon";
import { Button, EmptyState } from "../../components/ui";
import { isTeamId } from "../../lib/nav/remembered-team";
import { teamDisplayName } from "../../lib/team-lifecycle/model";
import {
  canManageTeam,
  greetingFor,
  landingSections,
  powerLabels,
  sectionsSummary,
} from "../../lib/team/member-landing";
import { loadWelcome, type WelcomeTeam } from "./welcome-data";
import "./welcome.css";

export const metadata = {
  title: "Welcome",
  description: "Your roles on the team and the sections you can open.",
};

const SECTION_ICONS: Record<string, IconName> = {
  competition: "swords",
  team: "users",
  build: "cube",
  business: "clipboard",
  ai: "sparkles",
  media: "camera",
};

function teamName(team: WelcomeTeam): string {
  return teamDisplayName({ teamNumber: team.teamNumber, name: team.orgName ?? "" });
}

/** Where sign-in lands: who you are on the team, and the sections you can open from here. */
export default async function WelcomePage({ searchParams }: { searchParams: Promise<{ orgId?: string }> }) {
  const { orgId } = await searchParams;
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/signin?next=%2Fwelcome");
  const data = await loadWelcome(session.user.id, session.user.name ?? null, isTeamId(orgId) ? orgId : null);
  const team = data.active;

  if (!team) {
    return (
      <main className="module-page welcome-page soft-gate">
        <header className="welcome-hero">
          <h1>{greetingFor(data.firstName)}</h1>
        </header>
        <EmptyState
          soft
          title={data.teams.length ? "You're not on this team" : "You're not on a team yet"}
          description={
            data.teams.length
              ? "Open one of your own teams to see your access."
              : "Join your team with the code or invitation from your team owner, and your sections show up here."
          }
        >
          <Button as="a" variant="primary" href={data.teams.length ? "/workspace?next=%2Fwelcome" : "/join-team"}>
            {data.teams.length ? "Choose your team" : "Join a team"}
          </Button>
        </EmptyState>
      </main>
    );
  }

  const sections = landingSections({
    orgId: team.orgId,
    role: team.role,
    hubAccess: team.hubAccess,
    sponsorsAllowed: team.sponsorsAllowed,
  });
  const powers = powerLabels(team.capabilities);
  const manager = canManageTeam(team.role);
  const homeHref = `/dashboard?orgId=${encodeURIComponent(team.orgId)}`;

  return (
    <main className="module-page welcome-page">
      <header className="welcome-hero">
        <p className="welcome-eyebrow">{teamName(team)}</p>
        <h1>{greetingFor(data.firstName)}</h1>
        <p className="welcome-lead">Your access on this team, and the sections you can open.</p>
        <ul className="welcome-roles" aria-label="Your roles">
          <li data-tone="role">{roleLabel(team.role)}</li>
          {powers.map((power) => (
            <li key={power}>{power}</li>
          ))}
          {data.platformAdmin ? <li data-tone="platform">Platform admin</li> : null}
        </ul>
        <div className="welcome-actions">
          <Button as="a" variant="primary" href={homeHref}>
            Go to Home
          </Button>
        </div>
      </header>

      <section className="welcome-block" aria-labelledby="welcome-sections-title">
        <h2 id="welcome-sections-title">Your sections</h2>
        <ul className="welcome-grid">
          {sections.map((section) => (
            <li key={section.id} className="welcome-tile">
              <a className="welcome-tile-main" href={section.href}>
                <span className="welcome-tile-icon">
                  <Icon name={SECTION_ICONS[section.id] ?? "grid"} />
                </span>
                <span className="welcome-tile-copy">
                  <strong>{section.label}</strong>
                  <span>{section.limited ? "Some pages" : section.description}</span>
                </span>
                <Icon name="chevron" className="welcome-tile-go" />
              </a>
              <nav className="welcome-chips" aria-label={`${section.label} shortcuts`}>
                {section.shortcuts.map((shortcut) => (
                  <a key={shortcut.href} href={shortcut.href}>
                    {shortcut.label}
                  </a>
                ))}
              </nav>
            </li>
          ))}
        </ul>
      </section>

      <section className="welcome-block welcome-details" aria-label="Your access">
        <article className="welcome-card">
          <h2>Your access</h2>
          <dl>
            <div>
              <dt>Role</dt>
              <dd>
                {roleLabel(team.role)}
                <small>{roleHint(team.role)}</small>
              </dd>
            </div>
            {powers.length || !manager ? (
              <div>
                <dt>Extra powers</dt>
                <dd>{powers.length ? powers.join(", ") : "None"}</dd>
              </div>
            ) : null}
            <div>
              <dt>Sections</dt>
              <dd>{sectionsSummary(sections)}</dd>
            </div>
          </dl>
          <p className="welcome-note">
            {manager ? (
              <a href={`/team/admin/permissions?orgId=${encodeURIComponent(team.orgId)}`}>Manage roles and permissions</a>
            ) : (
              "Need another section? Ask your team owner or a mentor."
            )}
            {data.platformAdmin ? (
              <>
                {" · "}
                <a href="/admin">Platform admin</a>
              </>
            ) : null}
          </p>
        </article>

        {data.teams.length > 1 ? (
          <article className="welcome-card">
            <h2>Your teams</h2>
            <ul className="welcome-teams">
              {data.teams.map((entry) => (
                <li key={entry.orgId}>
                  <a
                    href={`/welcome?orgId=${encodeURIComponent(entry.orgId)}`}
                    aria-current={entry.orgId === team.orgId ? "page" : undefined}
                  >
                    <span>{teamName(entry)}</span>
                    <small>{roleLabel(entry.role)}</small>
                  </a>
                </li>
              ))}
            </ul>
          </article>
        ) : null}
      </section>
    </main>
  );
}
