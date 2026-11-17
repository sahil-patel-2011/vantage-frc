import { SponsorsFundingGate } from "../../components/hub-access-gate";
import SponsorRenewalRoiClient from "./sponsor-renewal-roi-client";

export const metadata = {
  title: "Sponsor renewals",
};

export default function SponsorRenewalRoiPage() {
  return (
    <SponsorsFundingGate breadcrumbs={<>Business / Sponsor renewals</>}>
      <SponsorRenewalRoiClient />
    </SponsorsFundingGate>
  );
}
