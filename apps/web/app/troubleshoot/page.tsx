import TroubleshootClient from "./troubleshoot-client";

export const metadata = {
  title: "Get unstuck",
  description:
    "Check-by-check troubleshooting for the FRC control-system failures that stop teams: roboRIO imaging, deploys, driver station comms, radios, brownouts, CAN, and blink codes.",
};

export default function TroubleshootPage() {
  return <TroubleshootClient />;
}
