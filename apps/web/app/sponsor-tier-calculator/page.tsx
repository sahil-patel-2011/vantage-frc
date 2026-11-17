import { SponsorsFundingGate } from "../../components/hub-access-gate";
import SponsorTierCalculatorClient from "./sponsor-tier-calculator-client";

export const metadata = {
  title: "Sponsor tier calculator",
};

export default function SponsorTierCalculatorPage() {
  return (
    <SponsorsFundingGate breadcrumbs={<>Business / Sponsor tier calculator</>}>
      <SponsorTierCalculatorClient />
    </SponsorsFundingGate>
  );
}
