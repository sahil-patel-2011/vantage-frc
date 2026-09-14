import { SponsorsFundingGate } from "../../components/hub-access-gate";
import SponsorRenewalRoiClient from "./sponsor-renewal-roi-client";

export const metadata = {
  title: "Renewal ROI",
};

export default function SponsorRenewalRoiPage() {
  return (
    <SponsorsFundingGate breadcrumbs={<>Business / Renewal ROI</>}>
      <SponsorRenewalRoiClient />
    </SponsorsFundingGate>
  );
}
