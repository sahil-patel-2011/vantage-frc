import { VantageLogo } from "../../components/brand";
import { Button } from "../../components/ui";
import { onboardingReturnPath } from "../../lib/onboarding/entry-journey";
import "../join-team/join-team.css";

export const metadata = { title: "Account temporarily unavailable", robots: { index: false, follow: false } };

export default async function AccessUnavailablePage({ searchParams }: { searchParams: Promise<{ next?: string | string[] }> }) {
  const params = await searchParams;
  const next = typeof params.next === "string" ? params.next : null;
  const destination = onboardingReturnPath(next, "/dashboard");
  return <main className="join-team-page"><section className="join-team-card" aria-labelledby="access-unavailable-title">
    <VantageLogo />
    <h1 id="access-unavailable-title">We couldn’t check your access</h1>
    <p className="app-muted">Your account is temporarily unavailable. Try your page again in a moment.</p>
    <p><Button as="a" variant="primary" href={destination}>Try my page again</Button></p>
    <p className="join-team-alternative"><a href="/">Back to Vantage</a></p>
  </section></main>;
}
