import WiringDiagnoserClient from "./wiring-diagnoser-client";

export const metadata = {
  title: "Wiring check",
};

export default function WiringDiagnoserPage() {
  return <WiringDiagnoserClient />;
}
