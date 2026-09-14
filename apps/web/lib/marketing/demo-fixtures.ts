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

/** Marketing teaching demo — flag → explain why → safer pattern. */
export const codeLesson = {
  flagged: "Timer.delay(0.02) inside periodic()",
  why: "Blocks the robot thread, starving command scheduling, sensors, and safety checks for the full delay.",
  betterApproach: "Track elapsed time with a timestamp or a stateful command—never sleep on the main loop.",
  betterSample: `double now = Timer.getFPGATimestamp();
if (now - lastStepSec >= 0.02) {
  lastStepSec = now;
  // advance stateful work
}`,
  capabilities: [
    { id: "Review", detail: "Flag WPILib / vendor risks" },
    { id: "Explain", detail: "Teach why a pattern fails" },
    { id: "Suggest", detail: "Show safer habits" },
    { id: "Assist", detail: "Build & debug with approval" },
  ],
};

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
    { name: "Onshape hosted", status: "Needs setup" as const },
    { name: "Fusion local relay", status: "Needs setup" as const },
  ],
};
