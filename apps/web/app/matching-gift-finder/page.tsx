import { SponsorsFundingGate } from "../../components/hub-access-gate";
import MatchingGiftFinderClient from "./matching-gift-finder-client";

export const metadata = {
  title: "Matching Gift Multiplier Finder",
};

export default function MatchingGiftFinderPage() {
  return (
    <SponsorsFundingGate breadcrumbs={<>Business / Matching Gift Finder</>}>
      <MatchingGiftFinderClient />
    </SponsorsFundingGate>
  );
}
