import { SponsorsFundingGate } from "../../components/hub-access-gate";
import SponsorSuiteClient from "./sponsor-suite-client";

export default function SponsorSuitePage() {
  return (
    <SponsorsFundingGate breadcrumbs={<>Business / Sponsor Suite</>}>
      <SponsorSuiteClient />
    </SponsorsFundingGate>
  );
}
