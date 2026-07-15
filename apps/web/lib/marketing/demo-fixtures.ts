import { reviewFrcCode } from "@vantage/agent";
import { strategyFixture } from "./strategy-demo";

export { strategyFixture };

export const codeSample = `public void periodic() {
  Timer.delay(0.02);
  driveMotor.set(3);
}`;

export const codeFixture = reviewFrcCode({
  path: "src/main/java/frc/robot/subsystems/DriveSubsystem.java",
  content: codeSample,
});

export const cadFixture = {
  title: "Serviceable intake guard",
  brief:
    "Frame perimeter clear · existing 10-32 mounts · inspect interference before export",
  steps: [
    { id: "01", label: "Requirements + assumptions", state: "Confirmed" as const },
    { id: "02", label: "Reviewed action plan", state: "Approval" as const },
    { id: "03", label: "Geometry + topology checkpoint", state: "Queued" as const },
    { id: "04", label: "Render / BOM artifact", state: "Queued" as const },
  ],
  connectors: [
    { name: "Onshape hosted", status: "Setup required" as const },
    { name: "Fusion local relay", status: "Setup required" as const },
  ],
};
