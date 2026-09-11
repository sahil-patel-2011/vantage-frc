import dynamic from "next/dynamic";

const BuildHub = dynamic(() => import("./build-hub"));

export const metadata = {
  title: "Build",
  description: "Kickoff, CAD, code, and the robot.",
};

export default function BuildPage() {
  return <BuildHub />;
}
