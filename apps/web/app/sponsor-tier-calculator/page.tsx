import { SponsorsFundingGate } from "../../components/hub-access-gate";
import SponsorTierCalculatorClient from "./sponsor-tier-calculator-client";

export const metadata = {
  title: "Sponsor Tier Calculator",
};

export default function SponsorTierCalculatorPage() {
  return (
    <SponsorsFundingGate breadcrumbs={<>Business / Sponsor Tier Calculator</>}>
      <SponsorTierCalculatorClient />
    </SponsorsFundingGate>
  );
}
