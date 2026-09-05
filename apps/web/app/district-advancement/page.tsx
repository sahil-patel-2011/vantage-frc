import DistrictAdvancementClient from "./district-advancement-client";

export const metadata = {
  title: "District advancement",
  description: "District point trajectory from cached EPA — never DEMO qualification odds.",
};

export default function DistrictAdvancementPage() {
  return <DistrictAdvancementClient />;
}
