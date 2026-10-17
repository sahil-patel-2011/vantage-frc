import type { TrainingCategory } from "../training/types";

/**
 * The team's skill trees: what a member can learn, in the order it unlocks. Trees, groups and
 * prerequisites live here in code (like the guided tracks); each skill becomes one row in the
 * team's training_skills when a mentor sets the trees up, and a sign-off is an ordinary training
 * certification. So the Training matrix, expiry and the safety rules all keep working.
 *
 * Unlocking: a skill needs the one before it in its group; a group's first skill needs the
 * previous group's first skill; and every tree but Safety needs all of Safety first.
 */

export type SkillNodeDef = {
  /** Stable within the tree; the full key is `${tree}.${slug}`. */
  slug: string;
  title: string;
  blurb: string;
  /** Overrides the tree's training category (e.g. the mill and lathe nodes). */
  category?: TrainingCategory;
  /** Extra prerequisites by full key, on top of the group order. */
  requires?: string[];
};

export type SkillGroupDef = { title: string; nodes: SkillNodeDef[] };

export type SkillTreeDef = {
  key: string;
  title: string;
  summary: string;
  category: TrainingCategory;
  /** Months a sign-off lasts before it needs redoing (null: it doesn't expire). */
  validityMonths: number | null;
  groups: SkillGroupDef[];
};

export const SAFETY_TREE = "safety";

export const SKILL_TREES: readonly SkillTreeDef[] = [
  {
    key: SAFETY_TREE,
    title: "Safety",
    summary: "Required first: every other tree opens once this one is complete. Redone each year.",
    category: "safety",
    validityMonths: 12,
    groups: [
      {
        title: "Shop safety",
        nodes: [
          { slug: "ppe", title: "Eye protection and PPE", blurb: "Safety glasses, closed-toe shoes, hair and loose clothing rules." },
          { slug: "hand-tools", title: "Hand tools", blurb: "Using and putting away hand tools; cutting away from your body." },
          { slug: "emergency", title: "Emergency stops and first aid", blurb: "Where the stops, fire extinguisher and first-aid kit are, and who to tell." },
        ],
      },
      {
        title: "Batteries and power",
        nodes: [
          { slug: "battery-handling", title: "Battery handling and charging", blurb: "Carrying, charging and checking batteries; spotting a damaged one." },
          { slug: "power-off", title: "Main breaker and power-off", blurb: "Turning the robot off before touching it, every time." },
          { slug: "pinch-points", title: "Pinch points and moving parts", blurb: "Keeping hands clear of mechanisms that can move." },
        ],
      },
      {
        title: "Robot operation",
        nodes: [
          { slug: "enable", title: "Safe enable and disable", blurb: "Calling \"enabling\", watching the robot, and disabling fast." },
          { slug: "lifting", title: "Lifting and robot carts", blurb: "Two-person lifts and moving the robot on its cart." },
          { slug: "pit-rules", title: "Pit safety rules", blurb: "Safety glasses in the pit, clear aisles, no running." },
        ],
      },
    ],
  },
  {
    key: "manufacturing",
    title: "Manufacturing",
    summary: "From measuring a part to running the machines that make it.",
    category: "other",
    validityMonths: null,
    groups: [
      {
        title: "Measuring and layout",
        nodes: [
          { slug: "calipers", title: "Calipers and measuring", blurb: "Reading calipers and a tape to a drawing's tolerance." },
          { slug: "layout", title: "Layout and center punching", blurb: "Marking holes and cuts from a drawing." },
        ],
      },
      {
        title: "Shop tools",
        nodes: [
          { slug: "drill-press", title: "Drill press", blurb: "Clamping, speeds and drilling to a mark." },
          { slug: "saws", title: "Band saw and chop saw", blurb: "Cutting stock to length safely." },
          { slug: "tapping", title: "Tapping and reaming", blurb: "Threading holes straight and to size." },
        ],
      },
      {
        title: "Machines",
        nodes: [
          { slug: "mill", title: "Mill basics", blurb: "Workholding, indicating and simple pockets.", category: "mill" },
          { slug: "lathe", title: "Lathe basics", blurb: "Facing, turning and drilling on the lathe.", category: "lathe", requires: ["manufacturing.drill-press"] },
          { slug: "cnc", title: "CNC router", blurb: "Loading a job, zeroing and running it with a mentor nearby.", category: "mill" },
        ],
      },
    ],
  },
  {
    key: "design",
    title: "Design and CAD",
    summary: "Modeling parts and mechanisms the team can build.",
    category: "other",
    validityMonths: null,
    groups: [
      {
        title: "Onshape basics",
        nodes: [
          { slug: "sketches", title: "Sketches and constraints", blurb: "Fully defined sketches that update cleanly." },
          { slug: "parts", title: "Part studios and features", blurb: "Extrudes, holes, fillets and patterns." },
        ],
      },
      {
        title: "Assemblies",
        nodes: [
          { slug: "mates", title: "Assemblies and mates", blurb: "Putting parts together so they move like the real thing." },
          { slug: "drawings", title: "Drawings and tolerances", blurb: "Drawings the shop can make a part from." },
        ],
      },
      {
        title: "Mechanisms",
        nodes: [
          { slug: "ratios", title: "Gear and belt ratios", blurb: "Picking a ratio for speed or torque." },
          { slug: "review", title: "Design review", blurb: "Presenting a design and taking feedback." },
        ],
      },
    ],
  },
  {
    key: "electrical",
    title: "Electrical",
    summary: "Wiring a robot that stays connected through a whole event.",
    category: "wiring",
    validityMonths: null,
    groups: [
      {
        title: "Wiring basics",
        nodes: [
          { slug: "gauges", title: "Wire gauges and standards", blurb: "Which wire for which current, and the color rules." },
          { slug: "crimping", title: "Crimping and connectors", blurb: "Crimps that pass a pull test." },
        ],
      },
      {
        title: "Robot power",
        nodes: [
          { slug: "distribution", title: "Power distribution and breakers", blurb: "Laying out the power distribution and sizing breakers." },
          { slug: "can", title: "CAN bus wiring", blurb: "Daisy-chaining CAN and terminating it." },
        ],
      },
      {
        title: "Diagnostics",
        nodes: [
          { slug: "driver-station", title: "Driver station and logs", blurb: "Reading the driver station and its logs after a match." },
          { slug: "troubleshooting", title: "Troubleshooting faults", blurb: "Finding a brownout, a loose wire or a bad controller." },
        ],
      },
    ],
  },
  {
    key: "programming",
    title: "Programming",
    summary: "Robot code from the first motor to autonomous.",
    category: "software",
    validityMonths: null,
    groups: [
      {
        title: "Foundations",
        nodes: [
          { slug: "java", title: "Java and WPILib basics", blurb: "Writing and deploying a simple robot program." },
          { slug: "git", title: "Git and pull requests", blurb: "Branches, commits and reviewing changes." },
        ],
      },
      {
        title: "Robot code",
        nodes: [
          { slug: "commands", title: "Command-based structure", blurb: "Subsystems, commands and button bindings." },
          { slug: "devices", title: "Motor controllers and sensors", blurb: "Configuring motors, encoders and limits." },
        ],
      },
      {
        title: "Advanced",
        nodes: [
          { slug: "auto", title: "Autonomous paths", blurb: "Building and tuning auto routines." },
          { slug: "vision", title: "Vision and pose estimation", blurb: "Using cameras to know where the robot is." },
          { slug: "testing", title: "Simulation and testing", blurb: "Testing code before it touches the robot." },
        ],
      },
    ],
  },
  {
    key: "drive",
    title: "Drive team and strategy",
    summary: "Driving, coaching and planning matches.",
    category: "drive",
    validityMonths: null,
    groups: [
      {
        title: "Drive practice",
        nodes: [
          { slug: "driving", title: "Basic driving", blurb: "Smooth, controlled driving through a practice course." },
          { slug: "awareness", title: "Field awareness", blurb: "Watching partners, opponents and the clock while driving." },
        ],
      },
      {
        title: "Match roles",
        nodes: [
          { slug: "human-player", title: "Human player", blurb: "The human player's job and its rules." },
          { slug: "coach", title: "Drive coach", blurb: "Calling the match and keeping the drivers on plan." },
        ],
      },
      {
        title: "Strategy",
        nodes: [
          { slug: "briefing", title: "Match strategy briefing", blurb: "Briefing partners in the queue." },
          { slug: "selection", title: "Alliance selection", blurb: "Representing the team at alliance selection." },
        ],
      },
    ],
  },
  {
    key: "scouting",
    title: "Scouting",
    summary: "Collecting data the team can trust and use.",
    category: "other",
    validityMonths: null,
    groups: [
      {
        title: "Match scouting",
        nodes: [
          { slug: "app", title: "Using the scouting app", blurb: "Scouting a full match, start to finish." },
          { slug: "accuracy", title: "Accurate counting", blurb: "Counts that match the official results." },
        ],
      },
      {
        title: "Pit scouting",
        nodes: [{ slug: "interviews", title: "Pit interviews", blurb: "Asking teams the right questions, politely and quickly." }],
      },
      {
        title: "Using the data",
        nodes: [
          { slug: "reports", title: "Reading team reports", blurb: "Turning scouting into a clear picture of a robot." },
          { slug: "pick-list", title: "Pick list discussion", blurb: "Making the case for a team at the pick list meeting." },
        ],
      },
    ],
  },
  {
    key: "pit",
    title: "Pit crew",
    summary: "Keeping the robot ready between matches.",
    category: "other",
    validityMonths: null,
    groups: [
      {
        title: "Pit setup",
        nodes: [
          { slug: "layout", title: "Pit layout and tools", blurb: "Setting up and packing the pit." },
          { slug: "batteries", title: "Battery rotation", blurb: "Charging and rotating batteries through an event." },
        ],
      },
      {
        title: "Between matches",
        nodes: [
          { slug: "checklist", title: "Pre-match checklist", blurb: "Running the checklist before every match." },
          { slug: "repairs", title: "Quick repairs", blurb: "Fixing common breaks before the next match." },
        ],
      },
      {
        title: "Inspection",
        nodes: [{ slug: "inspection", title: "Robot inspection", blurb: "Getting the robot through inspection." }],
      },
    ],
  },
  {
    key: "leadership",
    title: "Leadership and outreach",
    summary: "Representing the team and growing FIRST.",
    category: "other",
    validityMonths: null,
    groups: [
      {
        title: "Communication",
        nodes: [
          { slug: "presenting", title: "Team presentations", blurb: "Presenting the team to sponsors and visitors." },
          { slug: "mentoring", title: "Mentoring new members", blurb: "Teaching a skill you've signed off." },
        ],
      },
      {
        title: "Outreach",
        nodes: [
          { slug: "event", title: "Running an outreach event", blurb: "Planning and running a demo or workshop." },
          { slug: "media", title: "Photos and social media", blurb: "Sharing the team's work within the team's rules." },
        ],
      },
      {
        title: "Awards",
        nodes: [
          { slug: "impact", title: "Impact award writing", blurb: "Writing part of the team's award submission." },
          { slug: "judging", title: "Judging interviews", blurb: "Talking with judges about the team's work." },
        ],
      },
    ],
  },
];

export type SkillNode = SkillNodeDef & {
  key: string;
  tree: string;
  group: string;
  category: TrainingCategory;
  /** Every skill that must be signed off first. */
  prerequisites: string[];
};

/** Every node with its full key and prerequisites (group order + Safety gate + extras). */
export function allSkillNodes(trees: readonly SkillTreeDef[] = SKILL_TREES): SkillNode[] {
  const safety = trees.find((tree) => tree.key === SAFETY_TREE);
  const safetyKeys = safety ? safety.groups.flatMap((group) => group.nodes.map((node) => `${SAFETY_TREE}.${node.slug}`)) : [];
  const nodes: SkillNode[] = [];
  for (const tree of trees) {
    tree.groups.forEach((group, groupIndex) => {
      group.nodes.forEach((node, nodeIndex) => {
        const prerequisites = new Set<string>(node.requires ?? []);
        if (nodeIndex > 0) prerequisites.add(`${tree.key}.${group.nodes[nodeIndex - 1]!.slug}`);
        else if (groupIndex > 0) prerequisites.add(`${tree.key}.${tree.groups[groupIndex - 1]!.nodes[0]!.slug}`);
        if (tree.key !== SAFETY_TREE && nodeIndex === 0 && groupIndex === 0) for (const key of safetyKeys) prerequisites.add(key);
        nodes.push({
          ...node,
          key: `${tree.key}.${node.slug}`,
          tree: tree.key,
          group: group.title,
          category: node.category ?? tree.category,
          prerequisites: [...prerequisites],
        });
      });
    });
  }
  return nodes;
}

/** How a tree skill is recognised among the team's training skills. */
const MARKER = /\(skill tree: ([a-z0-9-]+\.[a-z0-9-]+)\)$/;

export function skillMarker(key: string) {
  return `(skill tree: ${key})`;
}

export function skillKeyFromDescription(description: string | null | undefined): string | null {
  return description?.match(MARKER)?.[1] ?? null;
}

/** The training_skills row a node becomes. */
export function trainingSkillForNode(node: SkillNode, tree: SkillTreeDef) {
  return {
    name: node.title,
    category: node.category,
    description: `${tree.title} · ${node.group}: ${node.blurb} ${skillMarker(node.key)}`,
    validityMonths: tree.validityMonths,
  };
}
