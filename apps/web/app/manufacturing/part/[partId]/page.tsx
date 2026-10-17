import PartStepsClient from "./part-steps-client";
import "../../shop-steps.css";

export const metadata = {
  title: "Part steps",
  description: "The steps to make this part, in order, with its drawing.",
};

export default async function PartStepsPage({ params }: { params: Promise<{ partId: string }> }) {
  const { partId } = await params;
  return <PartStepsClient partId={partId} />;
}
