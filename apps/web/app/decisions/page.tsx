import DecisionsClient from "./decisions-client";

export const metadata = {
  title: "Decision Log",
  description:
    "Decision log built from recorded entries only. Cross-links to Decision Search, Season Report, and Knowledge.",
};

export default function DecisionsPage() {
  return <DecisionsClient />;
}
