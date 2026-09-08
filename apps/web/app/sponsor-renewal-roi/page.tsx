import { SponsorsFundingGate } from "../../components/hub-access-gate";
import SponsorRenewalRoiClient from "./sponsor-renewal-roi-client";

export const metadata = {
  title: "Sponsor Renewal-Risk Score & ROI Report",
};

export default function SponsorRenewalRoiPage() {
  return (
    <SponsorsFundingGate breadcrumbs={<>Business / Sponsor Renewal ROI</>}>
      <SponsorRenewalRoiClient />
    </SponsorsFundingGate>
  );
}
