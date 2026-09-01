import { describe, expect, it } from "vitest";
import { buildRepoOverview, isRepoOverviewPath } from "./repo-overview";

describe("buildRepoOverview", () => {
  it("returns null when there is nothing honest to say", () => {
    expect(buildRepoOverview({})).toBeNull();
    expect(buildRepoOverview({ repo: "team/robot" })).toBeNull();
    expect(buildRepoOverview({ description: "DEMO swerve" })).toBeNull();
  });

  it("describes a WPILib Java tree from paths only", () => {
    const note = buildRepoOverview({
      repo: "frc254/robot2026",
      paths: [
        "src/main/java/frc/robot/Robot.java",
        "src/main/java/frc/robot/RobotContainer.java",
        "src/main/java/frc/robot/subsystems/Drive.java",
        "vendordeps/Phoenix6.json",
      ],
    });
    expect(note).toMatch(/frc254\/robot2026/);
    expect(note).toMatch(/Java/);
    expect(note).toMatch(/WPILib robot entry point/);
    expect(note).toMatch(/subsystems/);
    expect(note).toMatch(/vendordeps present/);
    expect(note).not.toMatch(/DEMO/i);
  });

  it("uses README text and a real WPILib year, never invents one", () => {
    const note = buildRepoOverview({
      files: [
        {
          path: "README.md",
          content: "# 254 robot\n\nSwerve + shooter for our 2026 bot.\n",
        },
        {
          path: ".wpilib/wpilib_preferences.json",
          content: '{"projectYear":"2026","teamNumber":254}',
        },
      ],
    });
    expect(note).toMatch(/README: 254 robot Swerve \+ shooter/);
    expect(note).toMatch(/WPILib project year 2026/);
    expect(note).not.toMatch(/invent/i);
  });
});

describe("isRepoOverviewPath", () => {
  it("matches the well-known overview files only", () => {
    expect(isRepoOverviewPath("README.md")).toBe(true);
    expect(isRepoOverviewPath("build.gradle")).toBe(true);
    expect(isRepoOverviewPath("src/main/java/frc/robot/Robot.java")).toBe(false);
  });
});
