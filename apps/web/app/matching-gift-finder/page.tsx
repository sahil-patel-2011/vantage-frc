import { SponsorsFundingGate } from "../../components/hub-access-gate";
import MatchingGiftFinderClient from "./matching-gift-finder-client";

export default function MatchingGiftFinderPage() {
  return (
    <SponsorsFundingGate breadcrumbs={<>Business / Matching Gift Finder</>}>
      <MatchingGiftFinderClient />
    </SponsorsFundingGate>
  );
}
