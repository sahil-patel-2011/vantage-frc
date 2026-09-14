/**
 * Code & CAD resources hub — one page that points at the tracks that already
 * exist, plus the Onshape drawing lesson. No invented scores.
 */

export type LearnResourceCard = {
  id: string;
  title: string;
  description: string;
  href: string;
  primary: string;
};

export const LEARN_RESOURCE_CARDS: LearnResourceCard[] = [
  {
    id: "dev-setup",
    title: "Programming setup",
    description: "Laptop setup for FRC: Git, VS Code, WPILib, PathPlanner, and GitHub.",
    href: "/dev-setup",
    primary: "Open programming setup",
  },
  {
    id: "cad-learn",
    title: "Learn Onshape",
    description: "Sketch, parts, mates, then a drawing for the shop. Ends in a graded part.",
    href: "/cad-learn",
    primary: "Open Learn CAD",
  },
  {
    id: "drawings",
    title: "Onshape drawings",
    description: "Views and dimensions so someone else can assemble what you modeled.",
    href: "/cad-learn#drawings",
    primary: "Open the drawings lesson",
  },
  {
    id: "team-6925",
    title: "Team 6925 lab",
    description: "Paced Limelight, WPILib, GitHub, and CAD Video Tutor weeks. Official docs only.",
    href: "/learn/6925",
    primary: "Open Team 6925 lab",
  },
];

export const LEARN_PAGE_DESCRIPTION =
  "Programming setup, Learn Onshape, shop drawings, and the Team 6925 lab — one list, official docs only.";
