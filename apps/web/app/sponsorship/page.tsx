import { SponsorsFundingGate } from "../../components/hub-access-gate";
import SponsorshipClient from "./sponsorship-client";
import "./sponsorship.css";

export const metadata = {
  title: "Sponsorship one-pagers · Vantage",
  description:
    "Compose org-isolated sponsorship value props — who we are, what we do, what we ask, and what sponsors get — then export PDF.",
};

export default function SponsorshipPage() {
  return (
    <SponsorsFundingGate breadcrumbs={<>Business / Sponsorship</>}>
      <SponsorshipClient />
    </SponsorsFundingGate>
  );
}
