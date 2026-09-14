import { SponsorsFundingGate } from "../../components/hub-access-gate";
import SponsorTierCalculatorClient from "./sponsor-tier-calculator-client";

export const metadata = {
  title: "Tier calculator",
};

export default function SponsorTierCalculatorPage() {
  return (
    <SponsorsFundingGate breadcrumbs={<>Business / Tier calculator</>}>
      <SponsorTierCalculatorClient />
    </SponsorsFundingGate>
  );
}
