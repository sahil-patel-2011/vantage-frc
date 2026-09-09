import AssemblyManualClient from "./assembly-manual-client";
import "./assembly-manual.css";

export const metadata = {
  title: "Assembly manual",
  description:
    "Turn your team's Onshape assembly into a printable, step-by-step build book: numbered steps with a render of each one, a parts callout, and cut, drill and tap instructions taken from the CAD — with anything the CAD does not specify marked for a human to confirm.",
};

export default function AssemblyManualPage() {
  return <AssemblyManualClient />;
}
