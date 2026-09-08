import WiringDiagnoserClient from "./wiring-diagnoser-client";

export const metadata = {
  title: "Wiring / Power Fault Diagnoser",
};

export default function WiringDiagnoserPage() {
  return <WiringDiagnoserClient />;
}
