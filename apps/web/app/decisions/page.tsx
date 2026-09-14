import DecisionsClient from "./decisions-client";

export const metadata = {
  title: "Decision notes",
  description:
    "Decision log built from recorded entries only. Cross-links to Search, Season report, and Knowledge.",
};

export default function DecisionsPage() {
  return <DecisionsClient />;
}
