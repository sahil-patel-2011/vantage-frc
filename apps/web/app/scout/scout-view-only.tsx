import { Button, EmptyState } from "../../components/ui";
import { VIEW_ONLY_MESSAGE } from "../../lib/nav/view-only";

/**
 * What a View only member (0715) sees instead of the pit or match form. The database refuses
 * their reports whatever the page shows; this says so before they spend a match watching a
 * robot, instead of after Save. The coverage counts stay open to them on Scouting home.
 */
export function ScoutViewOnly({ what, homeHref }: { what: "pit visits" | "match reports"; homeHref: string }) {
  return (
    <div className="qs-shell">
      <EmptyState badge="View only" title={`You can look at ${what}, not add them`} description={VIEW_ONLY_MESSAGE}>
        <Button as="a" variant="secondary" href={homeHref}>
          See what is scouted
        </Button>
      </EmptyState>
    </div>
  );
}
