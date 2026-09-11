import dynamic from "next/dynamic";

const PrintFarmClient = dynamic(() => import("./print-farm-client"));

export const metadata = {
  title: "Print farm",
};

export default function PrintFarmPage() {
  return <PrintFarmClient />;
}
