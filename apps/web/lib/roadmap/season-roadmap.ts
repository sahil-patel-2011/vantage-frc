/**
 * The rookie-survival season roadmap: a dated kickoff-to-first-event checklist.
 *
 * WHY THIS IS CODE AND NOT ROWS
 * -----------------------------
 * docs/COMMUNITY_DEMAND_RND.md, demand #8: "A rookie-season survival roadmap: a dated
 * kickoff-to-first-event checklist covering registration, inspection, funding, and the
 * administrative things no one tells you", for "rookie coaches and de facto lead mentors
 * who 'know nothing of the strategy, the competitions, organizing'". The evidence also
 * says the free content already exists and is excellent but scattered — so every task here
 * links the canonical free resource rather than authoring a replacement for it.
 *
 * The roadmap CONTENT lives in this file, not in a table. When we learn something new
 * about registration or inspection, every team gets it on the next deploy — a seeded
 * template would only help teams created after the seed ran. Only PROGRESS is stored
 * (season_roadmap_progress, migration 0459).
 *
 * WHY EVERY DATE IS RELATIVE
 * --------------------------
 * FIRST publishes new deadlines every season and reorganises its site between them.
 * Hard-coding "October 18" would be fabricated data the moment the season turns over.
 * Every window here is expressed in days relative to the kickoff date the team enters,
 * derived from FIRST's own published season structure (fall registration, a January
 * kickoff, a six-week-ish build, week-1 events about seven weeks out). Exact deadlines
 * are always deferred to firstinspires.org — see KICKOFF_ACCURACY_NOTE.
 *
 * Pure module: no DB, no network, no Date.now(). Colocated tests cover the invariants.
 */
import { resourceLink, type ResourceLink } from "../ui/curated-resources";

export type RoadmapPhaseId =
  | "preseason"
  | "kickoff"
  | "build-1"
  | "build-2"
  | "build-3"
  | "build-4"
  | "build-5"
  | "build-6"
  | "pre-event"
  | "competition"
  | "offseason";

export type RoadmapOwnerRole =
  | "lead-mentor"
  | "business-team"
  | "build-team"
  | "programming"
  | "drive-team"
  | "safety-captain"
  | "whole-team";

/** Days relative to kickoff. Kickoff Saturday is day 0; preseason days are negative. */
export type RelativeWindow = { startDay: number; endDay: number };

export type RoadmapTask = {
  id: string;
  phaseId: RoadmapPhaseId;
  title: string;
  /** The consequence of skipping it. Rookies repeat mistakes because nobody said why. */
  why: string;
  whenRelativeToKickoff: RelativeWindow;
  ownerRole: RoadmapOwnerRole;
  /** Canonical free resources, from the curated registry. Never Vantage pages. */
  resourceLinks: ResourceLink[];
  /** Veteran teams hide these; a rookie team cannot afford to miss one. */
  isRookieCritical: boolean;
  /** Where our own guidance stops and the current season's manual takes over. */
  caveat?: string;
};

export type RoadmapPhase = {
  id: RoadmapPhaseId;
  label: string;
  blurb: string;
  window: RelativeWindow;
};

export const KICKOFF_ACCURACY_NOTE =
  "Every date below is calculated from the kickoff date you entered, using FIRST's usual season shape. FIRST sets the real registration, payment, and event deadlines each season — confirm them on firstinspires.org before you plan money or travel around a date here.";

export const ROADMAP_PHASES: RoadmapPhase[] = [
  {
    id: "preseason",
    label: "Preseason",
    blurb:
      "Registration, money, adults screened, students rostered, a space to work in. Almost everything that kills a rookie team happens — or fails to happen — here, months before a robot exists.",
    window: { startDay: -180, endDay: -1 },
  },
  {
    id: "kickoff",
    label: "Kickoff weekend",
    blurb:
      "Watch the reveal, read the manual yourselves, and decide what you are NOT building. The scoping decision made this weekend determines whether the robot is finished.",
    window: { startDay: 0, endDay: 2 },
  },
  {
    id: "build-1",
    label: "Build week 1",
    blurb: "Prototype the scoring idea. Pick the robot you can actually finish.",
    window: { startDay: 0, endDay: 6 },
  },
  {
    id: "build-2",
    label: "Build week 2",
    blurb: "Freeze the architecture and order anything with a lead time.",
    window: { startDay: 7, endDay: 13 },
  },
  {
    id: "build-3",
    label: "Build week 3",
    blurb: "A driving chassis. Everything downstream is blocked until this exists.",
    window: { startDay: 14, endDay: 20 },
  },
  {
    id: "build-4",
    label: "Build week 4",
    blurb: "Code on the real robot, and the first honest weight and size check.",
    window: { startDay: 21, endDay: 27 },
  },
  {
    id: "build-5",
    label: "Build week 5",
    blurb: "Full scoring cycles, legal bumpers, and drive practice hours.",
    window: { startDay: 28, endDay: 34 },
  },
  {
    id: "build-6",
    label: "Build week 6",
    blurb: "Self-inspect against the official checklist and name the drive team.",
    window: { startDay: 35, endDay: 41 },
  },
  {
    id: "pre-event",
    label: "Pre-event",
    blurb:
      "Paperwork, pit kit, travel, food, and the pack list. This is the week rookies lose to logistics rather than to robots.",
    window: { startDay: 42, endDay: 48 },
  },
  {
    id: "competition",
    label: "Competition",
    blurb: "Get inspected, ask for help, and take a photo of every robot in the pits.",
    window: { startDay: 49, endDay: 112 },
  },
  {
    id: "offseason",
    label: "Offseason",
    blurb:
      "Write down what you learned, and start the funding work for next year — teams most commonly die two years after their rookie season, when rookie grants expire.",
    window: { startDay: 113, endDay: 250 },
  },
];

const R = resourceLink;

export const ROADMAP_TASKS: RoadmapTask[] = [
  // ---------------------------------------------------------------- Preseason
  {
    id: "recruit-mentors",
    phaseId: "preseason",
    title: "Recruit more than one adult mentor",
    why: "The two documented causes of teams folding are lack of money and lack of mentors. One adult carrying the whole team is a single point of failure, and FIRST requires screened adults present anyway.",
    whenRelativeToKickoff: { startDay: -150, endDay: -30 },
    ownerRole: "lead-mentor",
    resourceLinks: [R("first-team-event-search"), R("chief-delphi")],
    isRookieCritical: true,
  },
  {
    id: "register-team",
    phaseId: "preseason",
    title: "Register the team with FIRST and pay the season fee",
    why: "Your team number, roster system access, kit of parts, and event registration all hang off this. Rookie registration is also what makes you eligible for the rookie kit and rookie grants.",
    whenRelativeToKickoff: { startDay: -150, endDay: -60 },
    ownerRole: "lead-mentor",
    resourceLinks: [R("frc-team-management"), R("first-team-event-search")],
    isRookieCritical: true,
    caveat:
      "Registration opens in the fall and the payment deadline that guarantees a spot is well before kickoff, but FIRST sets the exact dates each season. Check firstinspires.org — do not plan from this window alone.",
  },
  {
    id: "secure-season-funding",
    phaseId: "preseason",
    title: "Line up more than one funding source",
    why: "Registration and event fees are due long before you have a robot to show anyone. Roughly half of rookie teams that folded had exactly one sponsor — usually the school — against a median of three to four for teams that survived.",
    whenRelativeToKickoff: { startDay: -180, endDay: -30 },
    ownerRole: "business-team",
    resourceLinks: [R("first-fundraising-toolkit"), R("chief-delphi")],
    isRookieCritical: true,
  },
  {
    id: "adults-ypp-screening",
    phaseId: "preseason",
    title: "Get every adult screened through Youth Protection",
    why: "Unscreened adults cannot supervise students or work the pit, and screening takes days to weeks to come back. Teams discover this the week of their event, when it is too late.",
    whenRelativeToKickoff: { startDay: -140, endDay: -40 },
    ownerRole: "lead-mentor",
    resourceLinks: [R("first-resource-library"), R("frc-team-management")],
    isRookieCritical: true,
  },
  {
    id: "students-roster-consent",
    phaseId: "preseason",
    title: "Get students registered and consent & release forms signed",
    why: "A student who is not on the roster with a signed consent and release cannot compete, and often cannot be in the pit. Chasing signatures is the classic week-of scramble.",
    whenRelativeToKickoff: { startDay: -90, endDay: -7 },
    ownerRole: "lead-mentor",
    resourceLinks: [R("frc-team-management")],
    isRookieCritical: true,
  },
  {
    id: "choose-events",
    phaseId: "preseason",
    title: "Choose and pay for your events",
    why: "Events fill. Which event you pick sets your entire calendar — the build deadline, the travel budget, and how much time you have between competing and fixing.",
    whenRelativeToKickoff: { startDay: -120, endDay: -45 },
    ownerRole: "lead-mentor",
    resourceLinks: [R("frc-team-management"), R("first-team-event-search")],
    isRookieCritical: true,
    caveat:
      "District teams have a different registration path and deadline structure from teams in regional territories. Confirm which one you are in before assuming a date.",
  },
  {
    id: "space-and-tools",
    phaseId: "preseason",
    title: "Secure a workspace and a basic tool set",
    why: "You need somewhere you can leave a partly-built robot and somewhere students can safely use tools. Borrowing a shop for two evenings a week is a real constraint on what you can build — decide before kickoff, not during.",
    whenRelativeToKickoff: { startDay: -120, endDay: -30 },
    ownerRole: "lead-mentor",
    resourceLinks: [R("chief-delphi")],
    isRookieCritical: true,
  },
  {
    id: "set-a-budget",
    phaseId: "preseason",
    title: "Write down a season budget",
    why: "Registration, events, travel, and parts are the four big buckets, and the first two are due first. A budget written in the fall is what stops a February decision you cannot pay for.",
    whenRelativeToKickoff: { startDay: -90, endDay: -14 },
    ownerRole: "business-team",
    resourceLinks: [R("first-fundraising-toolkit")],
    isRookieCritical: true,
  },
  {
    id: "safety-plan",
    phaseId: "preseason",
    title: "Set shop safety rules and name a safety captain",
    why: "Safety glasses in the shop and at the event are non-negotiable, and events expect a team that can talk about its own safety practice. Establish it before the room is full of students and power tools.",
    whenRelativeToKickoff: { startDay: -60, endDay: 0 },
    ownerRole: "safety-captain",
    resourceLinks: [R("first-resource-library")],
    isRookieCritical: true,
  },
  {
    id: "preseason-training",
    phaseId: "preseason",
    title: "Run a preseason training block on last year's kit",
    why: "Six weeks is not enough time to teach CAD, wiring, and programming from zero. Teams that train in the fall spend the build season building. The free canonical courses are better than anything you would write.",
    whenRelativeToKickoff: { startDay: -90, endDay: -1 },
    ownerRole: "whole-team",
    resourceLinks: [R("wpilib-zero-to-robot"), R("frcdesign"), R("learnfrc")],
    isRookieCritical: true,
  },
  {
    id: "inventory-kit",
    phaseId: "preseason",
    title: "Inventory the kit of parts and vouchers as it arrives",
    why: "Kit contents and product vouchers arrive on FIRST's schedule, not yours, and vouchers expire. Knowing what you already have stops you buying a second one in week 2.",
    whenRelativeToKickoff: { startDay: -21, endDay: 7 },
    ownerRole: "build-team",
    resourceLinks: [R("frc-team-management")],
    isRookieCritical: false,
  },

  // ------------------------------------------------------------------ Kickoff
  {
    id: "watch-kickoff",
    phaseId: "kickoff",
    title: "Watch kickoff together and get the game materials",
    why: "The reveal, the manual, and the field drawings all drop at once. Watching as a team means everyone starts from the same understanding instead of from rumours.",
    whenRelativeToKickoff: { startDay: 0, endDay: 0 },
    ownerRole: "whole-team",
    resourceLinks: [R("frc-kickoff"), R("frc-game-manual")],
    isRookieCritical: true,
  },
  {
    id: "read-the-manual",
    phaseId: "kickoff",
    title: "Read the game manual yourselves — do not rely on a summary",
    why: "Every season, teams build something illegal because they took someone's forum summary as fact. The scoring section and the robot construction rules are the two that decide what you build.",
    whenRelativeToKickoff: { startDay: 0, endDay: 3 },
    ownerRole: "whole-team",
    resourceLinks: [R("frc-game-manual")],
    isRookieCritical: true,
  },
  {
    id: "scope-what-not-to-build",
    phaseId: "kickoff",
    title: "Decide what you are NOT building",
    why: "The community's standard answer to a rookie asking whether their plan is viable is: pick one or two hard things and do them reliably. A robot that drives and scores one thing every match beats an unfinished robot that could have done everything.",
    whenRelativeToKickoff: { startDay: 0, endDay: 5 },
    ownerRole: "whole-team",
    resourceLinks: [R("everybot"), R("open-alliance"), R("chief-delphi")],
    isRookieCritical: true,
  },
  {
    id: "subscribe-team-updates",
    phaseId: "kickoff",
    title: "Subscribe to Team Updates and check the Q&A weekly",
    why: "The manual changes during the season through Team Updates, and the official Q&A is the only binding interpretation. Teams fail inspection over a rule that changed in week 2 and nobody read.",
    whenRelativeToKickoff: { startDay: 0, endDay: 42 },
    ownerRole: "lead-mentor",
    resourceLinks: [R("frc-game-manual")],
    isRookieCritical: true,
  },

  // ------------------------------------------------------------- Build week 1
  {
    id: "kitbot-or-custom",
    phaseId: "build-1",
    title: "Decide: proven free design, or custom",
    why: "Everybot and the kitbot are complete, documented, buildable-with-basic-tools robots published free every season. For a first-year team they are usually the difference between competing and not competing — and choosing one early frees the whole build season for driving practice.",
    whenRelativeToKickoff: { startDay: 1, endDay: 7 },
    ownerRole: "whole-team",
    resourceLinks: [R("everybot"), R("open-alliance")],
    isRookieCritical: true,
  },
  {
    id: "prototype-before-cad",
    phaseId: "build-1",
    title: "Prototype the scoring mechanism out of scrap",
    why: "Wood, tape and spare wheels answer 'does this idea work' in an afternoon. Finding out in CAD takes a week, and finding out in week 5 costs you the season.",
    whenRelativeToKickoff: { startDay: 2, endDay: 10 },
    ownerRole: "build-team",
    resourceLinks: [R("open-alliance"), R("chief-delphi")],
    isRookieCritical: false,
  },
  {
    id: "field-elements",
    phaseId: "build-1",
    title: "Build the field elements you need to practise against",
    why: "You cannot tune a scoring mechanism against a guess. FIRST publishes official drawings and low-cost build guides for exactly this reason.",
    whenRelativeToKickoff: { startDay: 1, endDay: 14 },
    ownerRole: "build-team",
    resourceLinks: [R("frc-playing-field")],
    isRookieCritical: false,
  },

  // ------------------------------------------------------------- Build week 2
  {
    id: "freeze-architecture",
    phaseId: "build-2",
    title: "Freeze the drivetrain and overall architecture",
    why: "Everything else — wiring, code, weight, bumpers — is blocked on the frame. A team still arguing about the drivetrain in week 3 will not have drive practice.",
    whenRelativeToKickoff: { startDay: 8, endDay: 14 },
    ownerRole: "build-team",
    resourceLinks: [R("frcdesign"), R("open-alliance")],
    isRookieCritical: true,
  },
  {
    id: "order-long-lead-parts",
    phaseId: "build-2",
    title: "Order anything with a lead time — now",
    why: "In January every FRC vendor is backordered. Shipping, not machining, is what usually stops a rookie robot. Order the gearboxes, wheels, and control-system spares in week 2.",
    whenRelativeToKickoff: { startDay: 7, endDay: 17 },
    ownerRole: "build-team",
    resourceLinks: [R("chief-delphi")],
    isRookieCritical: true,
  },

  // ------------------------------------------------------------- Build week 3
  {
    id: "driving-chassis",
    phaseId: "build-3",
    title: "Have a driving chassis by the end of week 3",
    why: "Programmers need a real robot, drivers need hours, and every schedule problem after this point compounds. A rolling chassis at week 3 is the single best predictor of a rookie team finishing.",
    whenRelativeToKickoff: { startDay: 14, endDay: 21 },
    ownerRole: "build-team",
    resourceLinks: [R("wpilib-zero-to-robot")],
    isRookieCritical: true,
  },
  {
    id: "wiring-and-power",
    phaseId: "build-3",
    title: "Wire the control system to the current season's rules",
    why: "Wiring is an inspection item with its own rules — breaker sizes, wire gauge, main breaker placement, battery leads. Rookies routinely fail inspection here rather than on the mechanism.",
    whenRelativeToKickoff: { startDay: 14, endDay: 24 },
    ownerRole: "build-team",
    resourceLinks: [R("wpilib-zero-to-robot"), R("frc-game-manual")],
    isRookieCritical: true,
  },

  // ------------------------------------------------------------- Build week 4
  {
    id: "code-on-real-robot",
    phaseId: "build-4",
    title: "Get this season's code deployed and driving the real robot",
    why: "Imaging the roboRIO, updating firmware, configuring the radio, and deploying code is a multi-hour job the first time and a five-minute job every time after. Doing it for the first time at the event is how rookie teams lose their qualification matches.",
    whenRelativeToKickoff: { startDay: 21, endDay: 28 },
    ownerRole: "programming",
    resourceLinks: [R("wpilib-zero-to-robot"), R("wpilib-docs")],
    isRookieCritical: true,
  },
  {
    id: "weight-and-size-check",
    phaseId: "build-4",
    title: "Weigh and measure the robot against the manual's limits",
    why: "Weight and starting-size limits are hard inspection gates, and weight only ever goes up. Finding out you are over in week 6 means cutting something you needed.",
    whenRelativeToKickoff: { startDay: 21, endDay: 31 },
    ownerRole: "build-team",
    resourceLinks: [R("frc-game-manual")],
    isRookieCritical: true,
  },

  // ------------------------------------------------------------- Build week 5
  {
    id: "legal-bumpers",
    phaseId: "build-5",
    title: "Build bumpers to the letter of the rules",
    why: "Bumpers have their own detailed rules — dimensions, backing, fabric, numbers, corners — and are one of the most common reasons a rookie robot is sent back from inspection. Build them early and check them against the rules line by line.",
    whenRelativeToKickoff: { startDay: 28, endDay: 38 },
    ownerRole: "build-team",
    resourceLinks: [R("frc-game-manual")],
    isRookieCritical: true,
  },
  {
    id: "full-cycle-practice",
    phaseId: "build-5",
    title: "Run full scoring cycles and log drive practice hours",
    why: "Driver skill is the cheapest performance you can buy, and it is only bought with hours. A simple robot with a practised driver beats a complex robot with none.",
    whenRelativeToKickoff: { startDay: 28, endDay: 41 },
    ownerRole: "drive-team",
    resourceLinks: [R("open-alliance")],
    isRookieCritical: true,
  },

  // ------------------------------------------------------------- Build week 6
  {
    id: "self-inspect-at-home",
    phaseId: "build-6",
    title: "Self-inspect against the official inspection checklist",
    why: "The single highest-value thing a first-year team can do is make sure the robot will be allowed to compete. The checklist is published with the manual — run it at home, where you still have tools and time.",
    whenRelativeToKickoff: { startDay: 35, endDay: 45 },
    ownerRole: "build-team",
    resourceLinks: [R("frc-game-manual")],
    isRookieCritical: true,
  },
  {
    id: "robot-access-rules",
    phaseId: "build-6",
    title: "Check this season's rules on robot access after the build period",
    why: "Older guides describe 'bag and tag' — sealing the robot in a bag on a stop-build date. FRC has not run that way since 2019; recent seasons instead use a withholding allowance and unlimited access. Read the current manual rather than an old blog post, because your whole week-6 plan depends on which regime applies.",
    whenRelativeToKickoff: { startDay: 35, endDay: 45 },
    ownerRole: "lead-mentor",
    resourceLinks: [R("frc-game-manual")],
    isRookieCritical: true,
    caveat:
      "Vantage does not track which rule set is in force for your season. The manual is the only authority — verify before planning a stop-build date or a shipping day.",
  },
  {
    id: "name-the-drive-team",
    phaseId: "build-6",
    title: "Name the drive team and let them practise together",
    why: "Driver, operator, human player, and coach are four roles that have to work as one. Picking them the night before your event wastes the practice hours you already paid for.",
    whenRelativeToKickoff: { startDay: 35, endDay: 45 },
    ownerRole: "drive-team",
    resourceLinks: [R("chief-delphi")],
    isRookieCritical: false,
  },

  // ---------------------------------------------------------------- Pre-event
  {
    id: "event-paperwork",
    phaseId: "pre-event",
    title: "Confirm every attending student's roster and consent status",
    why: "A student without a completed consent and release cannot compete. Check the whole travelling roster a week out, not at the door.",
    whenRelativeToKickoff: { startDay: 30, endDay: 47 },
    ownerRole: "lead-mentor",
    resourceLinks: [R("frc-team-management")],
    isRookieCritical: true,
  },
  {
    id: "pit-setup",
    phaseId: "pre-event",
    title: "Pack the pit: tools, spares, power, and safety glasses",
    why: "Your pit is a small fixed space with an event-supplied table and power. Teams that arrive without an extension cord, a power strip, spare safety glasses for visitors, or their own basic tools spend day one borrowing instead of fixing.",
    whenRelativeToKickoff: { startDay: 39, endDay: 48 },
    ownerRole: "build-team",
    resourceLinks: [R("frc-game-manual"), R("first-resource-library")],
    isRookieCritical: true,
    caveat:
      "Pit dimensions, what the event supplies, and what is banned (open flames, certain adhesives, loose displays) are set by the current manual and your event. Check both.",
  },
  {
    id: "travel-and-food",
    phaseId: "pre-event",
    title: "Sort travel, food, and adult supervision for every event day",
    why: "Events run long days, venue food is expensive, and you need screened adults present the whole time. Logistics, not robots, is what exhausts a rookie team on day one.",
    whenRelativeToKickoff: { startDay: 30, endDay: 48 },
    ownerRole: "lead-mentor",
    resourceLinks: [R("first-resource-library")],
    isRookieCritical: true,
  },
  {
    id: "pack-list",
    phaseId: "pre-event",
    title: "Load out against a written pack list",
    why: "The thing you forget is always the thing you need. A written list, checked by two people, is the whole trick.",
    whenRelativeToKickoff: { startDay: 44, endDay: 48 },
    ownerRole: "build-team",
    resourceLinks: [R("chief-delphi")],
    isRookieCritical: true,
  },

  // ------------------------------------------------------------- Competition
  {
    id: "get-inspected-first",
    phaseId: "competition",
    title: "Get inspected before you do anything else on day one",
    why: "An uninspected robot cannot play, and inspectors get busier every hour. Passing early turns a crisis into a to-do list with time to fix it.",
    whenRelativeToKickoff: { startDay: 49, endDay: 51 },
    ownerRole: "build-team",
    resourceLinks: [R("frc-game-manual")],
    isRookieCritical: true,
  },
  {
    id: "ask-the-pit-next-door",
    phaseId: "competition",
    title: "Ask for help — from the pit next door and from your CSA",
    why: "This community's culture is that veteran teams will stop what they are doing to help a rookie, and Control System Advisors are at the event specifically to unstick you. Rookies lose entire days to a problem the neighbouring team would have fixed in ten minutes.",
    whenRelativeToKickoff: { startDay: 49, endDay: 56 },
    ownerRole: "whole-team",
    resourceLinks: [R("chief-delphi"), R("reddit-frc")],
    isRookieCritical: true,
  },
  {
    id: "awards-and-judging",
    phaseId: "competition",
    title: "Prepare for the judges — including Rookie All Star",
    why: "Judged awards are a real path to advancement that does not depend on your robot's scoring, and rookie-specific awards exist. The criteria are published; read them before writing anything.",
    whenRelativeToKickoff: { startDay: 42, endDay: 56 },
    ownerRole: "business-team",
    resourceLinks: [R("frc-awards"), R("first-resource-library")],
    isRookieCritical: true,
  },
  {
    id: "photograph-every-robot",
    phaseId: "competition",
    title: "Walk the pits and photograph every robot",
    why: "The most useful thing that comes out of pit scouting is a photo of every robot. It costs one student an hour and is worth more to your alliance conversations than a long questionnaire.",
    whenRelativeToKickoff: { startDay: 49, endDay: 56 },
    ownerRole: "whole-team",
    resourceLinks: [R("the-blue-alliance")],
    isRookieCritical: false,
  },
  {
    id: "scout-just-enough",
    phaseId: "competition",
    title: "Scout a small number of things, well",
    why: "Veterans consistently tell small teams to collect less. A short form filled in reliably beats a long form filled in badly — and public data already covers rankings and results for free.",
    whenRelativeToKickoff: { startDay: 49, endDay: 56 },
    ownerRole: "whole-team",
    resourceLinks: [R("the-blue-alliance"), R("statbotics")],
    isRookieCritical: false,
  },

  // ---------------------------------------------------------------- Offseason
  {
    id: "season-debrief",
    phaseId: "offseason",
    title: "Run an honest debrief while the season is still fresh",
    why: "Everything you learned lives in people's heads for about two weeks. Write down what broke, what you would do differently, and what you would build again.",
    whenRelativeToKickoff: { startDay: 113, endDay: 140 },
    ownerRole: "whole-team",
    resourceLinks: [R("chief-delphi")],
    isRookieCritical: false,
  },
  {
    id: "document-before-graduation",
    phaseId: "offseason",
    title: "Get knowledge out of graduating students before they leave",
    why: "The recurring crisis in this community is 'our only CAD person graduated and nobody taught me'. A seniors' handoff — how we wire it, how we deploy, where the passwords are — is worth more than any tool.",
    whenRelativeToKickoff: { startDay: 113, endDay: 170 },
    ownerRole: "whole-team",
    resourceLinks: [R("frcdesign"), R("wpilib-docs")],
    isRookieCritical: true,
  },
  {
    id: "year-two-funding",
    phaseId: "offseason",
    title: "Start next year's funding before the rookie grants expire",
    why: "Teams most commonly die two years after their rookie season — precisely when rookie and second-year grants run out. Adding a second and third sponsor in the offseason is the documented difference between surviving and folding.",
    whenRelativeToKickoff: { startDay: 113, endDay: 250 },
    ownerRole: "business-team",
    resourceLinks: [R("first-fundraising-toolkit"), R("frc-awards")],
    isRookieCritical: true,
  },
  {
    id: "offseason-training-and-events",
    phaseId: "offseason",
    title: "Train new members and go to an offseason event",
    why: "Offseason events are low-stakes practice for drivers, pit crew, and mentors, and the fall is when the free canonical courses actually fit into a schedule.",
    whenRelativeToKickoff: { startDay: 130, endDay: 240 },
    ownerRole: "whole-team",
    resourceLinks: [R("frcdesign"), R("learnfrc"), R("wpilib-zero-to-robot")],
    isRookieCritical: false,
  },
];

// ---------------------------------------------------------------------------
// Lookups
// ---------------------------------------------------------------------------

const PHASE_BY_ID = new Map(ROADMAP_PHASES.map((phase) => [phase.id, phase]));
const TASK_BY_ID = new Map(ROADMAP_TASKS.map((task) => [task.id, task]));

export function phaseById(id: string): RoadmapPhase | undefined {
  return PHASE_BY_ID.get(id as RoadmapPhaseId);
}

export function taskById(id: string): RoadmapTask | undefined {
  return TASK_BY_ID.get(id);
}

export function tasksForPhase(phaseId: RoadmapPhaseId, rookieOnly = false): RoadmapTask[] {
  return ROADMAP_TASKS.filter(
    (task) => task.phaseId === phaseId && (!rookieOnly || task.isRookieCritical),
  );
}

export const OWNER_ROLE_LABELS: Record<RoadmapOwnerRole, string> = {
  "lead-mentor": "Lead mentor",
  "business-team": "Business team",
  "build-team": "Build team",
  programming: "Programming",
  "drive-team": "Drive team",
  "safety-captain": "Safety captain",
  "whole-team": "Whole team",
};

// ---------------------------------------------------------------------------
// Dates — pure, UTC, ISO "YYYY-MM-DD" in and out
// ---------------------------------------------------------------------------

const DAY_MS = 86_400_000;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Parse an ISO date as UTC midnight. Returns null for anything malformed. */
export function parseIsoDate(value: string | null | undefined): number | null {
  if (typeof value !== "string" || !ISO_DATE.test(value)) return null;
  const ms = Date.parse(`${value}T00:00:00.000Z`);
  if (Number.isNaN(ms)) return null;
  // Reject impossible dates that Date.parse would roll over (2025-02-30).
  if (new Date(ms).toISOString().slice(0, 10) !== value) return null;
  return ms;
}

export function toIsoDate(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

export function addDays(isoDate: string, days: number): string | null {
  const ms = parseIsoDate(isoDate);
  if (ms == null) return null;
  return toIsoDate(ms + days * DAY_MS);
}

/** Whole days from `from` to `to`, both ISO dates. Null if either is malformed. */
export function daysBetween(from: string, to: string): number | null {
  const a = parseIsoDate(from);
  const b = parseIsoDate(to);
  if (a == null || b == null) return null;
  return Math.round((b - a) / DAY_MS);
}

export type DatedWindow = { start: string; end: string };

export function windowDates(window: RelativeWindow, kickoffDate: string): DatedWindow | null {
  const start = addDays(kickoffDate, window.startDay);
  const end = addDays(kickoffDate, window.endDay);
  if (!start || !end) return null;
  return { start, end };
}

/** Human phrasing that works with no kickoff date set. */
export function describeWindow(window: RelativeWindow): string {
  const { startDay, endDay } = window;
  if (endDay < 0) {
    const weeksBefore = Math.round(Math.abs(startDay) / 7);
    const weeksUntil = Math.round(Math.abs(endDay) / 7);
    return `About ${weeksBefore} to ${weeksUntil} weeks before kickoff`;
  }
  if (startDay === 0 && endDay === 0) return "Kickoff day";
  if (startDay <= 2 && endDay <= 5) return "Kickoff weekend";
  const startWeek = Math.floor(startDay / 7) + 1;
  const endWeek = Math.floor(endDay / 7) + 1;
  return startWeek === endWeek
    ? `Week ${startWeek} after kickoff`
    : `Weeks ${startWeek}–${endWeek} after kickoff`;
}

// ---------------------------------------------------------------------------
// Progress + the computed view
// ---------------------------------------------------------------------------

export type TaskStatus = "todo" | "done" | "skipped";
export const TASK_STATUSES: TaskStatus[] = ["todo", "done", "skipped"];

export function isTaskStatus(value: unknown): value is TaskStatus {
  return typeof value === "string" && (TASK_STATUSES as string[]).includes(value);
}

export type TaskProgress = {
  taskId: string;
  status: TaskStatus;
  note: string | null;
  completedByName: string | null;
  completedAt: string | null;
};

/**
 * Where a task stands relative to today. "overdue" only ever means "past the window
 * you told us about" — it is arithmetic on the team's own kickoff date, not a claim
 * about a FIRST deadline.
 */
export type TaskUrgency = "done" | "skipped" | "overdue" | "now" | "soon" | "later" | "undated";

const SOON_DAYS = 14;

export function taskUrgency(
  task: RoadmapTask,
  input: { kickoffDate: string | null; today: string; status: TaskStatus },
): TaskUrgency {
  if (input.status === "done") return "done";
  if (input.status === "skipped") return "skipped";
  if (!input.kickoffDate) return "undated";
  const dates = windowDates(task.whenRelativeToKickoff, input.kickoffDate);
  if (!dates) return "undated";
  const toStart = daysBetween(input.today, dates.start);
  const toEnd = daysBetween(input.today, dates.end);
  if (toStart == null || toEnd == null) return "undated";
  if (toEnd < 0) return "overdue";
  if (toStart <= 0) return "now";
  if (toStart <= SOON_DAYS) return "soon";
  return "later";
}

export type RoadmapTaskView = RoadmapTask & {
  status: TaskStatus;
  urgency: TaskUrgency;
  note: string | null;
  completedByName: string | null;
  completedAt: string | null;
  /** Null until the team enters a kickoff date. Never guessed. */
  dates: DatedWindow | null;
  whenLabel: string;
};

export type RoadmapPhaseView = RoadmapPhase & {
  tasks: RoadmapTaskView[];
  dates: DatedWindow | null;
  doneCount: number;
  skippedCount: number;
  totalCount: number;
};

export type RoadmapSummary = {
  total: number;
  done: number;
  skipped: number;
  overdue: number;
  dueNow: number;
  percentComplete: number;
};

export type SeasonRoadmapView = {
  kickoffDate: string | null;
  today: string;
  rookieOnly: boolean;
  phases: RoadmapPhaseView[];
  /** The answer to "what do we do next" — the top of the page. */
  dueNext: RoadmapTaskView[];
  summary: RoadmapSummary;
  accuracyNote: string;
};

export type BuildRoadmapInput = {
  /** ISO date the team entered. Null before they set one — the page says so. */
  kickoffDate: string | null;
  /** ISO date for "today", supplied by the caller so this module stays pure. */
  today: string;
  rookieOnly?: boolean;
  progress?: TaskProgress[];
  dueNextLimit?: number;
};

const URGENCY_RANK: Record<TaskUrgency, number> = {
  overdue: 0,
  now: 1,
  soon: 2,
  later: 3,
  undated: 4,
  done: 5,
  skipped: 6,
};

/**
 * The whole computed roadmap. Deterministic for a given (kickoffDate, today,
 * rookieOnly, progress) — no clock reads, no randomness, no DB.
 */
export function buildRoadmap(input: BuildRoadmapInput): SeasonRoadmapView {
  const kickoffDate = parseIsoDate(input.kickoffDate) == null ? null : input.kickoffDate;
  const rookieOnly = input.rookieOnly === true;
  const dueNextLimit = input.dueNextLimit ?? 5;

  const progressById = new Map<string, TaskProgress>();
  for (const row of input.progress ?? []) {
    if (taskById(row.taskId)) progressById.set(row.taskId, row);
  }

  const phases: RoadmapPhaseView[] = ROADMAP_PHASES.map((phase) => {
    const tasks = tasksForPhase(phase.id, rookieOnly).map((task): RoadmapTaskView => {
      const stored = progressById.get(task.id);
      const status: TaskStatus = stored && isTaskStatus(stored.status) ? stored.status : "todo";
      return {
        ...task,
        status,
        urgency: taskUrgency(task, { kickoffDate, today: input.today, status }),
        note: stored?.note ?? null,
        completedByName: stored?.completedByName ?? null,
        completedAt: stored?.completedAt ?? null,
        dates: kickoffDate ? windowDates(task.whenRelativeToKickoff, kickoffDate) : null,
        whenLabel: describeWindow(task.whenRelativeToKickoff),
      };
    });

    return {
      ...phase,
      tasks,
      dates: kickoffDate ? windowDates(phase.window, kickoffDate) : null,
      doneCount: tasks.filter((task) => task.status === "done").length,
      skippedCount: tasks.filter((task) => task.status === "skipped").length,
      totalCount: tasks.length,
    };
  });

  const allTasks = phases.flatMap((phase) => phase.tasks);
  const done = allTasks.filter((task) => task.status === "done").length;
  const skipped = allTasks.filter((task) => task.status === "skipped").length;
  const overdue = allTasks.filter((task) => task.urgency === "overdue").length;
  const dueNow = allTasks.filter((task) => task.urgency === "now").length;
  const counted = allTasks.length - skipped;

  const open = allTasks.filter((task) => task.status === "todo");
  const dueNext = [...open]
    .sort((a, b) => {
      const rank = URGENCY_RANK[a.urgency] - URGENCY_RANK[b.urgency];
      if (rank !== 0) return rank;
      const start = a.whenRelativeToKickoff.startDay - b.whenRelativeToKickoff.startDay;
      if (start !== 0) return start;
      if (a.isRookieCritical !== b.isRookieCritical) return a.isRookieCritical ? -1 : 1;
      return a.title.localeCompare(b.title);
    })
    .slice(0, Math.max(0, dueNextLimit));

  return {
    kickoffDate,
    today: input.today,
    rookieOnly,
    phases,
    dueNext,
    summary: {
      total: allTasks.length,
      done,
      skipped,
      overdue,
      dueNow,
      percentComplete: counted > 0 ? Math.round((done / counted) * 100) : 0,
    },
    accuracyNote: KICKOFF_ACCURACY_NOTE,
  };
}

/**
 * Is this org plausibly a rookie/second-year team, from teams_ref.rookie_year?
 * Returns null when we do not know — the page then offers a toggle rather than
 * guessing. Never infers rookie-ness from anything else.
 */
export function isRookieByYear(
  rookieYear: number | null | undefined,
  seasonYear: number,
): boolean | null {
  if (typeof rookieYear !== "number" || !Number.isFinite(rookieYear)) return null;
  if (rookieYear < 1992 || rookieYear > seasonYear + 1) return null;
  return seasonYear - rookieYear <= 1;
}

/** The competition year a kickoff date belongs to (kickoff is in January). */
export function seasonYearForKickoff(kickoffDate: string | null, fallbackToday: string): number {
  const iso = kickoffDate && parseIsoDate(kickoffDate) != null ? kickoffDate : fallbackToday;
  const ms = parseIsoDate(iso);
  if (ms == null) return new Date(0).getUTCFullYear();
  const date = new Date(ms);
  const year = date.getUTCFullYear();
  // A kickoff-relative roadmap opened in the autumn is planning next year's season.
  return kickoffDate ? year : date.getUTCMonth() >= 7 ? year + 1 : year;
}
