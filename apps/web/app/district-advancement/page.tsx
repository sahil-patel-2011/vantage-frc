import DistrictAdvancementClient from "./district-advancement-client";

export const metadata = {
  title: "Districts",
  description: "District point trajectory from cached season ratings.",
};

export default function DistrictAdvancementPage() {
  return <DistrictAdvancementClient />;
}
