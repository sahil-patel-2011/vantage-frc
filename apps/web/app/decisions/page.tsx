import DecisionsClient from "./decisions-client";

export const metadata = {
  title: "Decision Log",
  description:
    "Soft-UI ADR-style decision log from recorded entries only. Cross-links to Decision Search, Season Report, and Knowledge.",
};

export default function DecisionsPage() {
  return <DecisionsClient />;
}
