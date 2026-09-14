import { SponsorsFundingGate } from "../../components/hub-access-gate";
import MatchingGiftFinderClient from "./matching-gift-finder-client";

export const metadata = {
  title: "Matching gifts",
};

export default function MatchingGiftFinderPage() {
  return (
    <SponsorsFundingGate breadcrumbs={<>Business / Matching gifts</>}>
      <MatchingGiftFinderClient />
    </SponsorsFundingGate>
  );
}
