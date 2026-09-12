import { SponsorsFundingGate } from "../../components/hub-access-gate";
import SponsorWallClient from "./sponsor-wall-client";

export const metadata = {
  title: "Sponsor wall",
};

export default function SponsorWallPage() {
  return (
    <SponsorsFundingGate breadcrumbs={<>Business / Sponsor wall</>}>
      <SponsorWallClient />
    </SponsorsFundingGate>
  );
}
