import { SponsorsFundingGate } from "../../components/hub-access-gate";
import SponsorSuiteClient from "./sponsor-suite-client";

export const metadata = {
  title: "Sponsor suite",
};

export default function SponsorSuitePage() {
  return (
    <SponsorsFundingGate breadcrumbs={<>Business / Sponsor suite</>}>
      <SponsorSuiteClient />
    </SponsorsFundingGate>
  );
}
