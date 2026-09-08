import PairwiseClient from "./pairwise-client";

export const metadata = {
  title: "Pairwise ranking",
  description: "Qualitative A-beats-B ranking for driver skill, defense, and alliance fit — never DEMO ranks.",
};

export default function PairwisePage() {
  return <PairwiseClient />;
}
