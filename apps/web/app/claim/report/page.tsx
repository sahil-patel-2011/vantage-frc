import { Button, PageHeader } from "../../../components/ui";
import { LEGAL_CONTACT_EMAIL } from "../../../lib/legal/documents";
import { parseReportedTeamNumber, teamClaimReportMailto } from "../../../lib/claim/report";

export const metadata = {
  title: "Report a team claimed without authorization",
  description: "Tell Vantage when an FRC team number was claimed by someone who does not represent that team.",
};

export default async function TeamClaimReportPage({
  searchParams,
}: {
  searchParams: Promise<{ team?: string | string[] }>;
}) {
  const teamNumber = parseReportedTeamNumber((await searchParams).team);
  const teamLabel = teamNumber ? `Team ${teamNumber}` : "your team";

  return (
    <main className="module-page">
      <PageHeader
        title="Report a team claimed without authorization"
        description={`If ${teamLabel} was registered on Vantage by someone who is not a member, mentor or coach authorized by the team, tell us and we will look into it.`}
      />
      <section className="app-card soft-panel" aria-labelledby="claim-report-what">
        <h2 id="claim-report-what">What to include</h2>
        <ul>
          <li>The team number, and your name and role on the team.</li>
          <li>
            Something we can check: the team&apos;s official email or website, or confirmation from the team&apos;s lead
            mentor or coach.
          </li>
          <li>Whether you want the workspace transferred to the team or removed.</li>
        </ul>
        <p className="app-muted">
          The person who claimed a team number confirmed in writing that they were authorized to. That record is kept
          with the team and is reviewed with your report. Under the{" "}
          <a href="/terms#team-identities">Terms of Service</a>, Vantage may suspend, transfer or remove a workspace
          when a team&apos;s authorized representatives make a credible claim.
        </p>
        <p>
          <Button as="a" variant="primary" href={teamClaimReportMailto(teamNumber)}>
            Email a report{teamNumber ? ` about Team ${teamNumber}` : ""}
          </Button>
        </p>
        <p className="app-muted">
          If the email button does not open anything, write to <a href={`mailto:${LEGAL_CONTACT_EMAIL}`}>{LEGAL_CONTACT_EMAIL}</a>
          {teamNumber ? ` with “Team ${teamNumber}” in the subject` : ""}.
        </p>
      </section>
    </main>
  );
}
