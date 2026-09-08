import { SponsorsFundingGate } from "../../components/hub-access-gate";
import SponsorWallClient from "./sponsor-wall-client";

export const metadata = {
  title: "Sponsor Wall",
};

export default function SponsorWallPage() {
  return (
    <SponsorsFundingGate breadcrumbs={<>Business / Sponsor Wall</>}>
      <SponsorWallClient />
    </SponsorsFundingGate>
  );
}
