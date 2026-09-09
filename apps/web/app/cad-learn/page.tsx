import CadLearnClient from "./cad-learn-client";
import "./cad-learn.css";

export const metadata = {
  title: "CAD learning track",
  description:
    "Learn Onshape from the first sketch to a mated assembly — sketching, planes, extrude and revolve, fillets, Part Studios, in-context design, assemblies and mates — then have your part auto-graded on mass and moment of inertia against your team's reference.",
};

export default function CadLearnPage() {
  return <CadLearnClient />;
}
