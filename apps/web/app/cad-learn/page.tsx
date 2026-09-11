import CadLearnClient from "./cad-learn-client";
import "./cad-learn.css";

export const metadata = {
  title: "CAD learning track",
  description:
    "Learn Onshape from the first sketch to a mated assembly. At the end you link your part and Vantage checks how heavy it is — and how hard it is to spin — against your team's reference.",
};

export default function CadLearnPage() {
  return <CadLearnClient />;
}
