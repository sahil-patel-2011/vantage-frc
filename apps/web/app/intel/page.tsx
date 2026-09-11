import dynamic from "next/dynamic";
import "./intel.css";

const IntelClient = dynamic(() => import("./intel-client"));

export const metadata = {
  title: "Research",
};

export default function IntelPage() {
  return <IntelClient />;
}
