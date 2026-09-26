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
    id: "guided",
    title: "Checked step by step",
    description:
      "Onshape from zero to robot parts (a first part, an assembly, sheet metal, a shop drawing, parts from FRC libraries, a belt layout) and Team 6925's programming weeks. Vantage checks each step in your own Onshape document, build output or pull request before it counts.",
    href: "/learn/guided",
    primary: "Start a checked track",
  },
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
    description:
      "Two paced tracks: programming (WPILib to vision and autos) and mechanical (Onshape to pit repair). Official docs only.",
    href: "/learn/6925",
    primary: "Open Team 6925 lab",
  },
];

export const LEARN_PAGE_DESCRIPTION =
  "Programming setup, Learn Onshape, shop drawings, and the Team 6925 lab — one list, official docs only.";
