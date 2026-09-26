/**
 * Team 6925 mechanical and CAD, week by week: shop safety to pit repair, with Onshape (the team's
 * CAD) checked in the student's own Part Studio. What a week says about the team's robots comes
 * from the 2025 and 2026 build threads and the 2026 robot code; see the notes at the top of
 * frc6925.ts. The shop itself (tools, rules, who signs what) was not verifiable, so those steps
 * are written generally and signed off by a lead.
 *
 * Where a step's id matches an old week id (mech-1 … mech-9) it is the step whose check matches
 * that week's old check, so progress students already earned still shows.
 */

import type { PacedWeek } from "./frc6925";
import { leadSignoff, repoFile } from "./frc6925-steps";

const ONSHAPE_HELP = "https://cad.onshape.com/help/Content";

export const TEAM_6925_MECHANICAL_WEEKS: PacedWeek[] = [
  // ── Week 1 ────────────────────────────────────────────────────────────
  {
    id: "mech-week-1",
    track: "mechanical",
    week: 1,
    title: "Shop safety and tool basics",
    why: "Nobody touches a drill press or saw until they have been shown it. Safety glasses on, hair tied back, no loose sleeves: every time, not just when a mentor is watching.",
    doneWhen: "A lead has signed you off on the rules, on at least three tools, and on where the safety gear is.",
    minutes: 90,
    links: [
      {
        label: "FIRST season materials",
        href: "https://www.firstinspires.org/resources/library/frc/season-materials",
        primary: true,
      },
      { label: "Safety log", href: "/safety" },
    ],
    tasks: [
      {
        id: "mech-1-rules",
        title: "Learn the safety rules",
        why: "The game manual's safety rules apply at every event, and the team's shop rules apply every day. Knowing them before you pick up a tool is the point.",
        do: [
          "Read the safety section of this season's game manual.",
          "Read the team's shop rules, or ask a lead to walk you through them.",
          "Tell a lead three rules in your own words and why each one exists.",
        ],
        ...leadSignoff("You can explain three safety rules and why each exists."),
      },
      {
        id: "mech-1-tools",
        title: "Get signed off on your tools",
        why: "Every tool has one right way to hold, clamp and start it. A mentor showing you once is what stops the injury that ends a season.",
        do: [
          "Ask a mentor to show you each tool you will use: drill and drill press, band saw, hand tools, rivet gun.",
          "Use each one while they watch, with glasses on and work clamped.",
          "Only use a tool alone after you are signed off on it.",
        ],
        ...leadSignoff("You used at least three shop tools safely while a mentor watched."),
      },
      {
        id: "mech-1",
        title: "Know where the safety gear is",
        why: "In an emergency there is no time to look for the first-aid kit. Logging near misses the same day is how the team fixes a danger before someone gets hurt.",
        do: [
          "Find the first-aid kit, fire extinguisher and eyewash in the shop.",
          "Open the safety log in Vantage and read how a near miss is recorded.",
          "Log any near miss or injury the same day, even a small one.",
        ],
        ...leadSignoff("You can point to the first-aid kit, extinguisher and eyewash without looking, and know how to log a near miss."),
        links: [{ label: "Safety log", href: "/safety" }],
      },
    ],
  },

  // ── Week 2 ────────────────────────────────────────────────────────────
  {
    id: "mech-week-2",
    track: "mechanical",
    week: 2,
    title: "Onshape: your first checked part",
    why: "The team designs in Onshape. If a part is not in CAD, nobody else can build it, check it fits, or fix it at an event. Sketches, extrudes and holes are the whole foundation.",
    doneWhen: "Vantage has read a part of yours in Onshape with a sketch, an extrude, a hole or cut, and a material with a mass.",
    minutes: 150,
    links: [
      { label: "Your first Onshape part, checked step by step", href: "/learn/guided/onshape-first-part", primary: true },
      { label: "Onshape Learning Center", href: "https://learn.onshape.com/" },
      { label: "Learn CAD", href: "/cad-learn" },
    ],
    tasks: [
      {
        id: "mech-2-connect",
        title: "Connect Onshape to Vantage",
        why: "Vantage checks CAD by reading your own Part Studio through Onshape. It only reads; it never changes your document.",
        do: [
          "Make a free Onshape education account if you do not have one.",
          "In Vantage, open Learn CAD and connect your Onshape account.",
          "Come back here and check.",
        ],
        checkedBy: "Vantage checks your Onshape account is connected.",
        check: { kind: "onshape-connected" },
        links: [{ label: "Learn CAD", href: "/cad-learn" }],
      },
      {
        id: "mech-2-part",
        title: "Model a spacer block",
        why: "Nearly every robot part starts as a sketch pulled into a solid, with holes for bolts. A spacer block is that whole idea in one small part.",
        do: [
          "Create a new Onshape document named “Your name 6925 spacer”.",
          "Sketch a 2 in by 1 in rectangle on the Top plane and fully dimension it.",
          "Extrude it 0.5 in.",
          "Copy the Part Studio's address from the browser.",
        ],
        checkedBy: "Paste the Part Studio's address. Vantage reads it and looks for a sketch and an extrude.",
        check: {
          kind: "onshape-part-features",
          expect: [
            { featureType: "newSketch", label: "a sketch" },
            { featureType: "extrude", label: "an extrude" },
          ],
        },
        links: [{ label: "Onshape help: Extrude", href: `${ONSHAPE_HELP}/PartStudio/extrude.htm` }],
      },
      {
        id: "mech-2-hole",
        title: "Put the bolt hole in",
        why: "A part without its holes cannot be bolted to anything. The Hole tool makes a real clearance hole with the right size for the bolt.",
        do: [
          "In the same Part Studio, use the Hole tool for a #10 clearance hole, or sketch a circle and extrude it as a cut.",
          "Paste the same Part Studio address again.",
        ],
        checkedBy: "Vantage reads the Part Studio and looks for a Hole feature, or a second extrude (a cut).",
        links: [{ label: "Onshape help: Hole", href: `${ONSHAPE_HELP}/PartStudio/hole.htm` }],
        check: {
          kind: "onshape-part-features",
          anyOf: true,
          expect: [
            { featureType: "hole", label: "a Hole" },
            { featureType: "extrude", min: 2, label: "a second extrude (a cut)" },
          ],
        },
      },
      {
        id: "mech-2",
        title: "Give it a material and read its mass",
        why: "Weight is the budget every robot runs out of. A part with a material has a mass Onshape can add up for the whole robot.",
        do: [
          "Right-click the part, choose Assign material, and pick 6061 aluminum.",
          "Paste the Part Studio's address.",
        ],
        checkedBy: "Vantage reads the Part Studio from Onshape and checks every part has a material and Onshape reports a mass.",
        check: { kind: "onshape-material" },
      },
    ],
  },

  // ── Week 3 ────────────────────────────────────────────────────────────
  {
    id: "mech-week-3",
    track: "mechanical",
    week: 3,
    title: "Design to real stock, fasteners and vendor parts",
    why: "Robots are mostly aluminum tube, plate, hex shaft and bolts. Designing to stock you can buy, and pulling in the vendor's own CAD for bearings and modules, is what lets a part go from CAD to the robot in a day.",
    doneWhen: "You modeled a tube driven by a variable with a real hole pattern, pulled a vendor part into your Part Studio, bolted parts together in an Assembly, and named the parts of one real joint.",
    minutes: 180,
    links: [
      { label: "FRCDesign.org learning course", href: "https://www.frcdesign.org/learning-course/", primary: true },
      { label: "WCP docs", href: "https://docs.wcproducts.com/welcome" },
      { label: "Onshape help: Variable", href: `${ONSHAPE_HELP}/PartStudio/variable.htm` },
    ],
    tasks: [
      {
        id: "mech-3-variable",
        title: "Model a tube whose length is a variable",
        why: "Lengths change during design. A variable means you change one number and the tube, and everything built from it, follows.",
        do: [
          "In a new Part Studio, add a Variable named length set to 18 in.",
          "Sketch a 2 in by 1 in rectangle with a 1/16 in wall (an inner rectangle offset inward), the most common FRC tube.",
          "Extrude it by #length.",
          "Paste the Part Studio's address.",
        ],
        checkedBy: "Vantage reads the Part Studio and looks for a Variable and an extrude.",
        check: {
          kind: "onshape-part-features",
          expect: [
            { featureType: "assignVariable", label: "a Variable" },
            { featureType: "extrude", label: "an extrude" },
          ],
        },
        links: [{ label: "Onshape help: Variable", href: `${ONSHAPE_HELP}/PartStudio/variable.htm` }],
      },
      {
        id: "mech-3-pattern",
        title: "Drill the hole pattern",
        why: "Most FRC tube is drilled on a half-inch pattern so parts bolt on anywhere. One hole plus a linear pattern is faster and easier to change than twenty holes drawn by hand.",
        do: [
          "On the 2 in face, place one #10 clearance hole with the Hole tool, 0.5 in from the end.",
          "Use Linear pattern to repeat it every 0.5 in along the tube.",
          "Paste the Part Studio's address.",
        ],
        checkedBy: "Vantage reads the Part Studio and looks for a Hole and a Linear pattern.",
        check: {
          kind: "onshape-part-features",
          expect: [
            { featureType: "hole", label: "a Hole" },
            { featureType: "linearPattern", label: "a Linear pattern" },
          ],
        },
        links: [{ label: "Onshape help: Linear pattern", href: `${ONSHAPE_HELP}/PartStudio/linear_pattern.htm` }],
      },
      {
        id: "mech-3-derive",
        title: "Pull a vendor part into your design",
        why: "Vendors publish their parts in Onshape with the real dimensions. Deriving a bearing or a hex shaft from their document means your holes fit the real part, not a guess.",
        do: [
          "Find a bearing, hex shaft or gear in a vendor's public Onshape document (FRCDesign.org's resources page lists them).",
          "In your Part Studio, use Derived to bring that part in.",
          "Place a hole in your tube or a plate sized from the derived part.",
          "Paste your Part Studio's address.",
        ],
        checkedBy: "Vantage reads the Part Studio and looks for a Derived feature.",
        check: { kind: "onshape-part-features", expect: [{ featureType: "importDerived", label: "a Derived part" }] },
        links: [
          { label: "Onshape help: Derived", href: `${ONSHAPE_HELP}/PartStudio/derived.htm` },
          { label: "FRCDesign.org resources", href: "https://www.frcdesign.org/resources/" },
        ],
      },
      {
        id: "mech-3-assembly",
        title: "Bolt it together in an Assembly",
        why: "Parts only prove they fit when they are put together. Real bolts from Standard content and Fastened mates are how the robot's CAD is assembled.",
        do: [
          "Make an Assembly tab and insert your tube and a plate (or two copies of the tube).",
          "Fix the first part in place.",
          "Insert a #10-32 socket head cap screw from Standard content, through a hole in the pattern.",
          "Fasten the parts and the bolt together with Fastened mates, then paste the Assembly's address.",
        ],
        checkedBy: "Vantage reads the Assembly and looks for at least 3 parts, a bolt from Standard content and a Fastened mate, all with no errors.",
        check: {
          kind: "onshape-assembly",
          minInstances: 3,
          needsFixed: true,
          standardContent: 1,
          mates: [{ mateType: "FASTENED", label: "a Fastened mate" }],
        },
        links: [
          { label: "Your first assembly, checked step by step", href: "/learn/guided/onshape-first-assembly" },
          { label: "Onshape help: Mates", href: `${ONSHAPE_HELP}/Assembly/mates.htm` },
        ],
      },
      {
        id: "mech-3",
        title: "Name the parts of a real joint",
        why: "Knowing what holds the robot together (which tube, which bolt, which bearing) is what lets you fix it fast at an event.",
        do: [
          "Pick one joint on the current robot, for example where a swerve module bolts to the frame.",
          "Name the stock, the fasteners and any bearing or spacer in it.",
          "Check your answer against the robot itself, not the CAD alone.",
        ],
        ...leadSignoff("You named the stock, fasteners and bearing of one real joint, and it matches what is on the robot."),
      },
    ],
  },

  // ── Week 4 ────────────────────────────────────────────────────────────
  {
    id: "mech-week-4",
    track: "mechanical",
    week: 4,
    title: "Power transmission: gears, belts and chain",
    why: "A motor spins fast with little torque. The ratio decides whether a mechanism is quick, strong or stalls, and a wrong center distance means a belt that skips or a chain that falls off.",
    doneWhen: "Your ratio from real gear teeth matches the one in the robot code, and your CAD center distance matches ReCalc.",
    minutes: 120,
    links: [
      { label: "ReCalc", href: "https://www.reca.lc/", primary: true },
      { label: "Gearbox calculator", href: "/gearbox" },
      { label: "ReCalc belts", href: "https://www.reca.lc/belts" },
      { label: "ReCalc gears", href: "https://www.reca.lc/gears" },
    ],
    tasks: [
      {
        id: "mech-4-ratio",
        title: "Work out the swerve drive ratio from its gears",
        why: "The programmers' TunerConstants.java says the drive ratio is 6.1224:1. If the modules were built with different gears than the code expects, every distance the robot measures is wrong. You can catch that with a pencil.",
        do: [
          "Find the gear teeth for each stage of the swerve module's drive (SDS's MK4i page lists them for each gearing option).",
          "Multiply driven teeth over driving teeth for each stage.",
          "Check your answer with the gearbox calculator.",
          "Type your ratio and kDriveGearRatio from TunerConstants.java (6.1224 in 2026).",
        ],
        checkedBy: "Type your ratio and the one in the code. They must be within 0.01.",
        check: {
          kind: "numbers",
          fields: [
            { id: "yours", label: "your ratio from the gear teeth", unit: ":1" },
            { id: "code", label: "kDriveGearRatio in the code", unit: ":1" },
          ],
          within: { a: "yours", b: "code", tolerance: 0.01, unit: ":1" },
        },
        links: [
          { label: "SDS MK4i swerve module", href: "https://www.swervedrivespecialties.com/products/mk4i-swerve-module" },
          { label: "TunerConstants.java (2026)", href: repoFile("src/main/java/frc/robot/generated/TunerConstants.java") },
          { label: "Gearbox calculator", href: "/gearbox" },
        ],
      },
      {
        id: "mech-4",
        title: "Get a belt's center distance right",
        why: "Belts come in fixed lengths, so the two pulleys have to sit an exact distance apart. ReCalc gives that distance; your CAD has to match it.",
        do: [
          "Pick two pulleys (for example 18 and 36 teeth, HTD 5 mm) and a belt length in ReCalc's belt page.",
          "Write down ReCalc's center distance.",
          "In Onshape, place the two bearing holes that far apart, then measure between their centers.",
          "Type both numbers in inches.",
        ],
        checkedBy: "Type ReCalc's center distance and the one measured in your CAD. They must be within 0.005 inch.",
        check: {
          kind: "numbers",
          fields: [
            { id: "recalc", label: "ReCalc center distance", unit: "in" },
            { id: "cad", label: "center distance in your CAD", unit: "in" },
          ],
          within: { a: "recalc", b: "cad", tolerance: 0.005, unit: "in" },
        },
        links: [{ label: "ReCalc belts", href: "https://www.reca.lc/belts" }],
      },
    ],
  },

  // ── Week 5 ────────────────────────────────────────────────────────────
  {
    id: "mech-week-5",
    track: "mechanical",
    week: 5,
    title: "Shop drawings and making the part",
    why: "The person at the band saw should not need to open CAD. A drawing with the right dimensions and hole callouts is what turns your model into a part that fits.",
    doneWhen: "You modeled a symmetric plate, Vantage read your drawing of it, someone made it from the drawing, and the holes landed where the CAD says.",
    minutes: 150,
    links: [
      { label: "Onshape help: Drawings", href: `${ONSHAPE_HELP}/Drawing/drawings.htm`, primary: true },
      { label: "Learn CAD: drawings", href: "/cad-learn#drawings" },
    ],
    tasks: [
      {
        id: "mech-5-plate",
        title: "Model a symmetric plate",
        why: "Most robot plates are mirror images left to right. Model one side and mirror it, and a change on one side can never be forgotten on the other.",
        do: [
          "Model a 1/4 in aluminum plate with bolt holes on one half, using the Hole tool.",
          "Mirror the holes (or the whole half) across the center plane.",
          "Round the outside corners with a fillet so nobody gets cut.",
          "Paste the Part Studio's address.",
        ],
        checkedBy: "Vantage reads the Part Studio and looks for a Hole, a Mirror and a fillet.",
        check: {
          kind: "onshape-part-features",
          expect: [
            { featureType: "hole", label: "a Hole" },
            { featureType: "mirror", label: "a Mirror" },
            { featureType: "fillet", label: "a fillet" },
          ],
        },
        links: [{ label: "Onshape help: Mirror", href: `${ONSHAPE_HELP}/PartStudio/mirror.htm` }],
      },
      {
        id: "mech-5-drawing",
        title: "Draw it for the shop",
        why: "Dimensioning every hole from one edge (a datum) stops small errors adding up across the plate.",
        do: [
          "Make an Onshape drawing of the plate with a top view and one side view (for the thickness).",
          "Dimension the overall size, and every hole from the same two edges.",
          "Add a hole callout (size and count), and note the material and thickness.",
          "Copy the Drawing tab's address and paste it.",
        ],
        checkedBy: "Vantage reads the Drawing from Onshape and looks for at least 2 views and 4 dimensions.",
        check: { kind: "onshape-drawing", minViews: 2, minDimensions: 4 },
        links: [
          { label: "A shop drawing, checked step by step", href: "/learn/guided/onshape-drawing" },
          { label: "Onshape help: Drawings", href: `${ONSHAPE_HELP}/Drawing/drawings.htm` },
        ],
      },
      {
        id: "mech-5",
        title: "Make it and measure it",
        why: "The drawing is only right if someone else can make the part from it alone. Calipers on the real part are the proof.",
        do: [
          "Hand the drawing to someone else and have them lay out and drill the plate without asking you anything.",
          "With calipers, measure the center-to-center distance of the two holes farthest apart.",
          "Type that and the same distance from the drawing, in inches.",
        ],
        checkedBy: "Type the drawing's distance and the measured one. They must be within 0.010 inch.",
        check: {
          kind: "numbers",
          fields: [
            { id: "drawing", label: "distance on the drawing", unit: "in" },
            { id: "measured", label: "measured on the plate", unit: "in" },
          ],
          within: { a: "drawing", b: "measured", tolerance: 0.01, unit: "in" },
        },
      },
    ],
  },

  // ── Week 6 ────────────────────────────────────────────────────────────
  {
    id: "mech-week-6",
    track: "mechanical",
    week: 6,
    title: "Mechanisms: how the robot handles game pieces",
    why: "Most game pieces are handled by a few proven patterns. Knowing how each one fails (bent shafts, slack belts, backlash, binding) saves weeks of redesign.",
    doneWhen: "You checked the real intake pivot's reduction against the code, and a lead has read your failure list for one mechanism.",
    minutes: 150,
    links: [
      { label: "FRCDesign.org resources", href: "https://www.frcdesign.org/resources/", primary: true },
      { label: "ReCalc flywheel", href: "https://www.reca.lc/flywheel" },
      { label: "ReCalc arm", href: "https://www.reca.lc/arm" },
    ],
    tasks: [
      {
        id: "mech-6-pivot",
        title: "Check the intake pivot's reduction against the code",
        why: "The 2026 code tunes the intake pivot assuming an 8:1 reduction (a comment in CTREConfigs.java says so). If the real gearing is different, the pivot's speed and positions are off, and only someone who looks at the gears can tell.",
        do: [
          "Find the intake pivot on the robot (the Talon FX with CAN ID 50) and follow its drive to the pivot.",
          "Count the teeth on each stage and work out the total reduction.",
          "Type your reduction and the 8 from the code.",
          "If they differ, tell the programmers so they can fix the code.",
        ],
        checkedBy: "Type both reductions. They must be within 0.05.",
        check: {
          kind: "numbers",
          fields: [
            { id: "counted", label: "reduction you counted", unit: ":1" },
            { id: "code", label: "reduction in the code", unit: ":1" },
          ],
          within: { a: "counted", b: "code", tolerance: 0.05, unit: ":1" },
        },
        links: [{ label: "CTREConfigs.java (2026)", href: repoFile("src/main/java/frc/robot/CTREConfigs.java") }],
      },
      {
        id: "mech-6",
        title: "List how one mechanism fails",
        why: "The 2026 robot has a three-motor flywheel shooter, a servo-driven hood, a pivoting intake with a roller, and a feeder. Each fails in its own ways, and writing them down is how the pit is ready for them.",
        do: [
          "Pick one mechanism on the current robot.",
          "Find two similar designs on FRCDesign.org.",
          "List its likely failures (for example: flywheel belt slip, hood servo stalling, intake pivot hitting its hard stop).",
          "Write how it is kept inside its limits: hard stops, limits in code, or both.",
        ],
        ...leadSignoff("Your failure list for one mechanism is realistic and says how the mechanism is kept inside its limits."),
      },
    ],
  },

  // ── Week 7 ────────────────────────────────────────────────────────────
  {
    id: "mech-week-7",
    track: "mechanical",
    week: 7,
    title: "Prototyping fast",
    why: "A cardboard-and-wood prototype built in an afternoon answers questions CAD cannot (how much squeeze a game piece needs, what roller speed works) before you cut aluminum.",
    doneWhen: "The prototype tracker has your question, the numbers you measured, the decision, and a photo or video.",
    minutes: 120,
    links: [
      { label: "Prototype tracker", href: "/prototype-tracker", primary: true },
      { label: "FRCDesign.org learning course", href: "https://www.frcdesign.org/learning-course/" },
    ],
    tasks: [
      {
        id: "mech-7-question",
        title: "Write the one question the prototype answers",
        why: "A prototype without a question turns into a second robot. One question keeps it to an afternoon.",
        do: [
          "Write one question, for example: “does half an inch of squeeze grab the game piece every time?”",
          "Write what result would make you choose each option.",
          "Add it to the prototype tracker.",
        ],
        ...leadSignoff("The prototype has one clear question and what each answer would decide, in the tracker."),
        links: [{ label: "Prototype tracker", href: "/prototype-tracker" }],
      },
      {
        id: "mech-7",
        title: "Build it, measure it, decide",
        why: "The numbers from a real test (distances, squeeze, speeds) are what the CAD is then built around.",
        do: [
          "Build it from cardboard, wood or polycarbonate, with a drill as the motor.",
          "Measure what worked before anyone opens CAD.",
          "Record the numbers, the decision and a photo or video in the prototype tracker.",
        ],
        ...leadSignoff("The tracker entry has the measured numbers, the decision, and a photo or video."),
      },
    ],
  },

  // ── Week 8 ────────────────────────────────────────────────────────────
  {
    id: "mech-week-8",
    track: "mechanical",
    week: 8,
    title: "Weight budget, rules and inspection",
    why: "Robots fail inspection for weight, frame perimeter and bumpers far more than for anything clever. Tracking weight from day one beats drilling lightening holes at 2 a.m.",
    doneWhen: "A subsystem's CAD mass matches the scale, the weight budget is current, and every failing inspection item has an owner.",
    minutes: 90,
    links: [
      {
        label: "FIRST season materials (game manual)",
        href: "https://www.firstinspires.org/resources/library/frc/season-materials",
        primary: true,
      },
      { label: "Weight budget", href: "/weight-budget" },
      { label: "Robot inspection checklist", href: "/inspection" },
    ],
    tasks: [
      {
        id: "mech-8-cad",
        title: "Read a subsystem's mass from CAD",
        why: "If every part has a material, Onshape adds up a subsystem's weight before anything is built.",
        do: [
          "Open the Part Studio of one subsystem you worked on and check every part has a material.",
          "Paste its address.",
        ],
        checkedBy: "Vantage reads the Part Studio from Onshape and checks every part has a material and Onshape reports a mass.",
        check: { kind: "onshape-material" },
      },
      {
        id: "mech-8",
        title: "Weigh the real subsystem",
        why: "CAD misses bolts, wires and grease. Comparing CAD to the scale tells you how much to add to every other estimate.",
        do: [
          "Weigh the built subsystem on a scale, in pounds.",
          "Type the scale weight and the CAD mass (in pounds) from the last step.",
          "Put the scale weight in the weight budget.",
        ],
        checkedBy: "Type both weights. They must be within 1 lb; if not, find what CAD is missing and add it.",
        check: {
          kind: "numbers",
          fields: [
            { id: "cad", label: "mass in CAD", unit: "lb" },
            { id: "scale", label: "weight on the scale", unit: "lb" },
          ],
          within: { a: "cad", b: "scale", tolerance: 1, unit: "lb" },
        },
        links: [{ label: "Weight budget", href: "/weight-budget" }],
      },
      {
        id: "mech-8-inspect",
        title: "Walk the inspection checklist",
        why: "Finding an inspection problem in your own shop costs an evening. Finding it at the event costs matches.",
        do: [
          "Read this season's robot rules: weight limit, frame perimeter, height and bumpers.",
          "Walk the inspection checklist in Vantage against the current robot.",
          "Give every failing item an owner and a date.",
        ],
        ...leadSignoff("The inspection checklist has no failing item without an owner."),
        links: [{ label: "Robot inspection checklist", href: "/inspection" }],
      },
    ],
  },

  // ── Week 9 ────────────────────────────────────────────────────────────
  {
    id: "mech-week-9",
    track: "mechanical",
    week: 9,
    title: "Wiring, maintenance and pit repair",
    why: "Between matches you have minutes, not hours. Tidy wiring, a maintenance routine and a pit repair plan keep a small problem from becoming a dead robot on the field.",
    doneWhen: "The robot's wiring passes a lead's check, the between-match checklist is printed, and you timed one repair.",
    minutes: 90,
    links: [
      {
        label: "Wiring best practices",
        href: "https://docs.wpilib.org/en/stable/docs/hardware/hardware-basics/wiring-best-practices.html",
        primary: true,
      },
      {
        label: "Robot battery basics",
        href: "https://docs.wpilib.org/en/stable/docs/hardware/hardware-basics/robot-battery.html",
      },
      { label: "Pit repair triage", href: "/pit-repair-triage" },
    ],
    tasks: [
      {
        id: "mech-9-wiring",
        title: "Check the wiring",
        why: "A loose connector or a CAN wire with no strain relief is the most common cause of a robot that dies mid-match.",
        do: [
          "Read WPILib's wiring best practices.",
          "On the robot, tug-test connectors, and check strain relief and labels on CAN and power wires.",
          "Fix or report anything loose.",
        ],
        ...leadSignoff("The robot's wiring has strain relief, no loose connectors, and labeled CAN and power wires."),
      },
      {
        id: "mech-9-checklist",
        title: "Write the between-match checklist",
        why: "A printed list means the same checks happen every match, even when everyone is tired.",
        do: [
          "List the checks: bolts on high-load joints, belt and chain tension, bumpers, battery strap, battery voltage.",
          "Label batteries so the weakest one is never used in an elimination match.",
          "Print the list and tape it in the pit.",
        ],
        ...leadSignoff("The between-match checklist is printed in the pit and batteries are labeled."),
        links: [{ label: "Robot battery basics", href: "https://docs.wpilib.org/en/stable/docs/hardware/hardware-basics/robot-battery.html" }],
      },
      {
        id: "mech-9",
        title: "Practise one repair against the clock",
        why: "Doing a repair once in the shop, timed, is what makes it fast when a match is waiting.",
        do: [
          "Pick a likely repair from the pit repair triage page (for example swapping a swerve module or a broken belt).",
          "Time it from “it broke” to “robot ready”.",
          "Write down what slowed you down and fix that for next time.",
        ],
        ...leadSignoff("You timed one repair from “it broke” to “robot ready” and wrote down what slowed you down."),
        links: [{ label: "Pit repair triage", href: "/pit-repair-triage" }],
      },
    ],
  },
];
