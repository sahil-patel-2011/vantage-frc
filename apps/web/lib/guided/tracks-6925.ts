import { trackMinutes, weeksForTrack, type LabTrack } from "../team-resources/frc6925";
import type { GuidedStep, GuidedTrack } from "./types";

/* ------------------------------------------- Team 6925: programming and mechanical/CAD */

/**
 * Every small step of every week, in order, as a checked step. The weeks (and each step's check)
 * live in lib/team-resources/frc6925-*.ts, so the lab page and the checked track never disagree.
 */
function weeksAsSteps(track: LabTrack): GuidedStep[] {
  return weeksForTrack(track).flatMap((week) =>
    week.tasks.map((task, index) => ({
      id: task.id,
      title: `Week ${week.week}, step ${index + 1} of ${week.tasks.length}: ${task.title}`,
      why: task.why,
      do: task.do,
      checkedBy: task.checkedBy,
      check: task.check,
      links: (task.links?.length ? task.links : week.links).slice(0, 4).map((link) => ({ label: link.label, href: link.href })),
    })),
  );
}

function hours(track: LabTrack): string {
  return `${weeksForTrack(track).length} weeks, about ${Math.round(trackMinutes(track) / 60)} hours in all`;
}

const FRC6925_PROGRAMMING: GuidedTrack = {
  id: "frc6925-programming",
  title: "Team 6925 programming, step by step",
  summary:
    "From a new laptop to competition code in the team's own stack: WPILib Java, command-based, CTRE Phoenix 6 on a CANivore, the generated swerve drive, PathPlanner autos, Limelight MegaTag2 and Phoenix logs. Each step is checked by Vantage (your build or deploy output, your code, GitHub, measured numbers) or, where no software can see it, signed off by a lead.",
  time: hours("programming"),
  audience: "Team 6925 programmers, first year and up.",
  steps: weeksAsSteps("programming"),
};

const FRC6925_MECHANICAL: GuidedTrack = {
  id: "frc6925-mechanical",
  title: "Team 6925 mechanical and CAD, step by step",
  summary:
    "Shop safety to pit repair: tools, Onshape, stock and vendor parts, power transmission, drawings, mechanisms, prototyping, weight and wiring. Onshape steps are checked in your own Part Studio, measured steps compare your numbers, and shop steps are signed off by a lead.",
  time: hours("mechanical"),
  audience: "Team 6925 build and CAD students.",
  steps: weeksAsSteps("mechanical"),
};

/** Team 6925's own weeks: programming and mechanical/CAD. */
export const FRC6925_TRACKS: GuidedTrack[] = [FRC6925_PROGRAMMING, FRC6925_MECHANICAL];
