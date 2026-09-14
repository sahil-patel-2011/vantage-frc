import CadLearnClient from "./cad-learn-client";
import "./cad-learn.css";

export const metadata = {
  title: "CAD learning track",
  description:
    "Learn Onshape from the first sketch, then CAD Video Tutor on cast iron. At the end you link your part and Vantage reads mass and spin from Onshape against your team's reference.",
};

export default function CadLearnPage() {
  return <CadLearnClient />;
}
