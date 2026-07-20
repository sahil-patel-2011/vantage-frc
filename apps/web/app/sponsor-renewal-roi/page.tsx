import { SponsorsFundingGate } from "../../components/hub-access-gate";
import SponsorRenewalRoiClient from "./sponsor-renewal-roi-client";

export default function SponsorRenewalRoiPage() {
  return (
    <SponsorsFundingGate breadcrumbs={<>Business / Sponsor Renewal ROI</>}>
      <SponsorRenewalRoiClient />
    </SponsorsFundingGate>
  );
}
