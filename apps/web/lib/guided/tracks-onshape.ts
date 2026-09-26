import type { GuidedStep, GuidedTrack } from "./types";

/*
 * Onshape tracks: zero to robot CAD. Every step is checked by reading the student's own document
 * through the Onshape API (checks-onshape.ts), so a step only counts when the thing is really in
 * their document. Clicks use Onshape's own words for its tools (cad.onshape.com/help).
 */

const CONNECT_LINK = { label: "CAD connections", href: "/cad/connections" };
const HELP = (label: string, path: string) => ({ label: `Onshape help: ${label}`, href: `https://cad.onshape.com/help/Content/${path}` });

/** The same first step on every track, so a student can start anywhere. */
function connectStep(): GuidedStep {
  return {
    id: "connect",
    title: "Connect your Onshape account",
    why: "Vantage checks your work by reading your own Onshape document, so it needs your permission. It only reads; it never changes your CAD.",
    do: [
      "Make a free Onshape Education account at onshape.com if you do not have one (use your school email).",
      "In Vantage open CAD → Connections and press Connect Onshape, then approve the access Onshape asks for.",
      "Come back to this page and press Check my work.",
    ],
    checkedBy: "Vantage asks Onshape whether your account is connected.",
    check: { kind: "onshape-connected" },
    links: [CONNECT_LINK],
  };
}

/* ------------------------------------------------------------ 1. Your first part */

const ONSHAPE_FIRST_PART: GuidedTrack = {
  id: "onshape-first-part",
  title: "Your first Onshape part, checked step by step",
  summary:
    "A 6 × 4 inch mounting plate from a blank Part Studio: a dimensioned sketch, an extrude, #10 holes, rounded corners, a thickness variable and a material. After each step Vantage reads your Part Studio in Onshape and tells you whether it is there.",
  time: "About 90 minutes",
  audience: "New CAD students. No CAD experience needed.",
  steps: [
    connectStep(),
    {
      id: "part-studio",
      title: "Make a document and name the Part Studio “Plate”",
      why: "One document per mechanism keeps a robot's CAD findable. The Part Studio is where parts are drawn, and a real name tells the next person what is in it.",
      do: [
        "In Onshape press Create → Document and name it “Mounting plate – your name”.",
        "Right-click the Part Studio 1 tab at the bottom, choose Rename and type Plate.",
        "With the Plate tab open, copy the address from the browser's address bar and paste it below. Vantage remembers it for the rest of this track.",
      ],
      checkedBy: "Vantage opens your document and looks for a Part Studio tab called Plate.",
      check: { kind: "onshape-tab", tab: "PARTSTUDIO", name: "Plate" },
    },
    {
      id: "sketch",
      title: "Sketch a 6 × 4 inch rectangle on the Top plane",
      why: "Every part starts as a 2D sketch. Dimensions make it exact instead of “about right”.",
      do: [
        "Press Sketch, then click Top in the feature list (or the Top plane in the view).",
        "Pick Center point rectangle, click the origin, move out and click again.",
        "Press Dimension (d). Click the top edge, click to place it and type 6 in; click a side edge and type 4 in. The lines turn black when the sketch is fully defined.",
        "Press the green check to close the sketch.",
      ],
      checkedBy: "Vantage reads your sketches and looks for one with at least 4 lines and 2 dimensions.",
      check: { kind: "onshape-sketch", minLines: 4, minDimensions: 2 },
      links: [HELP("Sketch tools", "sketch-tools-dimension.htm")],
    },
    {
      id: "extrude",
      title: "Extrude it into a 0.25 inch plate",
      why: "An extrude pushes the flat sketch into a solid you can cut, weigh and send to the shop.",
      do: [
        "Press Extrude (Shift+e) and click inside the rectangle so the region turns blue.",
        "Leave it on New, set Depth to 0.25 in and press the green check. A solid part appears in the Parts list.",
      ],
      checkedBy: "Vantage looks for an extrude with no errors.",
      check: { kind: "onshape-part-features", expect: [{ featureType: "extrude", label: "an extrude" }] },
    },
    {
      id: "holes",
      title: "Add four #10 clearance holes",
      why: "Holes placed from dimensions line up with the real frame; holes placed by eye do not. #10 bolts are the most common FRC fastener.",
      do: [
        "Press Sketch and click the top face of the plate.",
        "Pick Point and click four points near the corners. Dimension each point 0.5 in from the two nearest edges, then press the green check.",
        "Press Hole. Style: Simple. Type: Clearance, Standard ANSI, Size #10, Fastener fit Normal (ASME). Termination: Through all.",
        "Click the four points and press the green check.",
      ],
      checkedBy: "Vantage looks for a Hole feature, or a second extrude that cuts material away.",
      check: {
        kind: "onshape-part-features",
        anyOf: true,
        expect: [
          { featureType: "hole", label: "a Hole" },
          { featureType: "extrude", min: 2, label: "a second extrude (a cut)" },
        ],
      },
      links: [HELP("Hole", "PartStudio/hole.htm")],
    },
    {
      id: "fillet",
      title: "Round the four corners",
      why: "Sharp corners cut hands and wires. A 0.25 in round is easy to make on a router or by hand.",
      do: ["Press Fillet, click the four short vertical edges at the corners, set Radius to 0.25 in and press the green check."],
      checkedBy: "Vantage looks for a fillet with no errors.",
      check: { kind: "onshape-part-features", expect: [{ featureType: "fillet", label: "a fillet" }] },
    },
    {
      id: "variable",
      title: "Make the thickness a variable and use it",
      why: "When the plate goes from 0.25 in to 0.125 in, one number changes instead of hunting through features.",
      do: [
        "Press Variable on the toolbar. Name it thickness, leave the type on Length, set the value to 0.25 in and press the green check.",
        "Drag the Variable to the top of the feature list, above the sketch.",
        "Double-click Extrude 1 and type #thickness as the depth. Press the green check.",
      ],
      checkedBy: "Vantage looks for a variable called thickness and a feature that uses #thickness.",
      check: { kind: "onshape-variable", names: ["thickness"], where: "partstudio", usedInFeature: true },
      links: [HELP("Variable", "PartStudio/variable.htm")],
    },
    {
      id: "material",
      title: "Give the part a material",
      why: "Weight budgets and center-of-mass checks come from the material. A part with no material weighs nothing.",
      do: [
        "Right-click the part in the Parts list, choose Assign material, search 6061 and pick Aluminum 6061. Press the green check.",
        "Check the weight with the Mass properties tool (the scale icon at the bottom right): a little under 0.6 lb for this plate.",
      ],
      checkedBy: "Vantage reads the part's material and mass from Onshape. Every part needs a material and Onshape must report a mass.",
      check: { kind: "onshape-material" },
    },
  ],
};

/* ------------------------------------------------------------ 2. Your first assembly */

const ONSHAPE_FIRST_ASSEMBLY: GuidedTrack = {
  id: "onshape-first-assembly",
  title: "Your first assembly: a pivoting arm",
  summary:
    "Put two copies of your plate together so one swings on a bolt, like an intake arm. You insert parts, fix one, add a Revolute mate and a Fastened bolt. Vantage reads the Assembly after each step and counts the parts and mates.",
  time: "About 60 minutes",
  audience: "Students who finished Your first Onshape part.",
  steps: [
    connectStep(),
    {
      id: "assembly-tab",
      title: "Make an Assembly called “Pivot”",
      why: "Part Studios make parts; Assemblies show how parts move together. Robots are built in Assemblies.",
      do: [
        "Open your Mounting plate document.",
        "Press + at the bottom-left and choose Create Assembly.",
        "Right-click the new Assembly tab, choose Rename and type Pivot. Copy the address and paste it below.",
      ],
      checkedBy: "Vantage looks for an Assembly tab called Pivot in your document.",
      check: { kind: "onshape-tab", tab: "ASSEMBLY", name: "Pivot" },
    },
    {
      id: "insert",
      title: "Insert two copies of your plate",
      why: "One copy will stay still (the robot frame); the other will be the arm.",
      do: [
        "In Pivot press Insert parts and assemblies (i).",
        "Choose Current document, click Plate, then click the part.",
        "Move the mouse into the graphics area and click twice to place two copies. Close the dialog.",
      ],
      checkedBy: "Vantage reads the Assembly and counts at least 2 instances.",
      check: { kind: "onshape-assembly", minInstances: 2 },
      links: [HELP("Insert parts and assemblies", "Assembly/insert_parts_and_assemblies.htm")],
    },
    {
      id: "fix",
      title: "Fix the first plate in place",
      why: "Something has to stay still so the rest can move against it, just like the robot frame.",
      do: ["In the Instances list, right-click Plate <1> and choose Fix. A pin icon shows next to it."],
      checkedBy: "Vantage reads which instances are fixed. At least one must be.",
      check: { kind: "onshape-assembly", minInstances: 2, needsFixed: true },
    },
    {
      id: "revolute",
      title: "Make the second plate swing with a Revolute mate",
      why: "A Revolute mate is a hinge: it lets a part spin around one axis and nothing else. Arms, wheels and rollers all use one.",
      do: [
        "Press Revolute mate on the toolbar.",
        "Hover the edge of a hole on the top face of the fixed plate until a dot appears at the hole's center, and click it.",
        "Hover a hole on the bottom face of the second plate and click its center dot, so the plates stack.",
        "Press the green check. Drag the second plate: it now spins around the hole.",
      ],
      checkedBy: "Vantage reads the Assembly's mates and looks for a Revolute mate with no errors.",
      check: {
        kind: "onshape-assembly",
        minInstances: 2,
        needsFixed: true,
        mates: [{ mateType: "REVOLUTE", label: "a Revolute mate" }],
      },
    },
    {
      id: "bolt",
      title: "Add a #10-32 bolt and fasten it",
      why: "Real pivots have a bolt through them. Standard content gives you real bolt sizes without drawing them.",
      do: [
        "Press Insert parts and assemblies (i) and choose Standard content.",
        "Search socket head and pick a socket head cap screw: Size #10-32, Length 0.75 in. Click in the view to place it and close the dialog.",
        "Press Fastened mate. Click the center dot under the bolt head, then the center dot on the top of the arm's pivot hole. Press the green check.",
      ],
      checkedBy: "Vantage looks for a part from Standard content, a Fastened mate, and your Revolute mate, all with no errors.",
      check: {
        kind: "onshape-assembly",
        minInstances: 3,
        standardContent: 1,
        mates: [
          { mateType: "REVOLUTE", label: "a Revolute mate" },
          { mateType: "FASTENED", label: "a Fastened mate" },
        ],
      },
    },
  ],
};

/* ------------------------------------------------------------ 3. Sheet metal */

const ONSHAPE_SHEET_METAL: GuidedTrack = {
  id: "onshape-sheet-metal",
  title: "A sheet-metal bracket with a flat pattern",
  summary:
    "An L-bracket in 0.090 inch aluminum, the kind that holds a motor or bearing to 2 × 1 tube. You make a Sheet metal model, add a flange and holes, and get the flat pattern the shop cuts. Vantage checks each feature and that Onshape has a flat pattern.",
  time: "About 60 minutes",
  audience: "Students who finished Your first Onshape part.",
  steps: [
    connectStep(),
    {
      id: "sketch",
      title: "Sketch the 3 × 2 inch base",
      do: [
        "Create a new document called “Bracket – your name” and open its Part Studio.",
        "Press Sketch, click Top, pick Center point rectangle and draw a rectangle on the origin.",
        "Dimension it 3 in wide and 2 in deep, then press the green check.",
        "Copy the address and paste it below.",
      ],
      checkedBy: "Vantage looks for a sketch with at least 4 lines and 2 dimensions.",
      check: { kind: "onshape-sketch", minLines: 4, minDimensions: 2 },
    },
    {
      id: "model",
      title: "Turn it into a Sheet metal model",
      why: "Sheet metal parts are one even thickness with bends. Modeling them this way is what makes a flat pattern possible.",
      do: [
        "Press Sheet metal model on the toolbar.",
        "Choose Thicken and click the rectangle's region.",
        "Set Thickness to 0.09 in and Bend radius to 0.09 in. Leave K Factor at 0.45. Press the green check.",
      ],
      checkedBy: "Vantage looks for a Sheet metal model feature with no errors.",
      check: { kind: "onshape-part-features", expect: [{ featureType: "sheetMetalStart", label: "a Sheet metal model" }] },
      links: [HELP("Sheet metal model", "PartStudio/sheet_metal_model.htm")],
    },
    {
      id: "flange",
      title: "Bend up a 1.5 inch flange",
      why: "The flange is the second leg of the L. It bolts to the tube while the base holds the motor.",
      do: [
        "Press Flange and click one of the long (3 in) edges of the plate.",
        "Set Distance to 1.5 in and press the green check. The flange folds up with the bend radius you chose.",
      ],
      checkedBy: "Vantage looks for a Flange feature with no errors.",
      check: {
        kind: "onshape-part-features",
        expect: [
          { featureType: "sheetMetalStart", label: "a Sheet metal model" },
          { featureType: "sheetMetalFlange", label: "a Flange" },
        ],
      },
      links: [HELP("Flange", "PartStudio/sheet_metal_flange.htm")],
    },
    {
      id: "holes",
      title: "Put #10 holes in the flange",
      why: "FRC tube is drilled on a 0.5 inch grid, so bracket holes 0.5 in apart line up with it.",
      do: [
        "Sketch on the outside face of the flange. Place two points 1 in apart, 0.5 in up from the bend, centered on the flange. Press the green check.",
        "Press Hole: Simple, Clearance, ANSI, #10, Fastener fit Normal (ASME), Through all. Click both points and press the green check.",
      ],
      checkedBy: "Vantage looks for a Hole feature in the sheet metal part, with no errors.",
      check: {
        kind: "onshape-part-features",
        expect: [
          { featureType: "sheetMetalFlange", label: "a Flange" },
          { featureType: "hole", label: "a Hole" },
        ],
      },
    },
    {
      id: "flat",
      title: "Look at the flat pattern",
      why: "The shop cuts the flat pattern, then bends it. If there is no clean flat pattern, the part cannot be made.",
      do: [
        "Click Sheet metal table and flat view, midway down the right side of the window. The flat pattern shows with bend lines.",
        "Optional: right-click the flat pattern and export it as DXF for the router or laser.",
      ],
      checkedBy: "Vantage asks Onshape for the part's flat pattern and checks no sheet metal feature has an error.",
      check: { kind: "onshape-flat-pattern" },
      links: [HELP("Sheet metal table and flat view", "PartStudio/sheet_metal_table.htm")],
    },
    {
      id: "material",
      title: "Make it aluminum",
      do: ["Right-click the part in the Parts list, choose Assign material and pick an aluminum such as 5052 or 6061. Press the green check."],
      checkedBy: "Vantage reads the part's material and mass from Onshape.",
      check: { kind: "onshape-material" },
    },
  ],
};

/* ------------------------------------------------------------ 4. Drawings */

const ONSHAPE_DRAWING: GuidedTrack = {
  id: "onshape-drawing",
  title: "A shop drawing of your plate",
  summary:
    "Turn your mounting plate into a drawing someone else can make it from: three views and the dimensions that matter. Vantage reads the Drawing and counts its views and dimensions.",
  time: "About 45 minutes",
  audience: "Students who finished Your first Onshape part.",
  steps: [
    connectStep(),
    {
      id: "create",
      title: "Create a drawing of the plate",
      why: "The shop builds from a drawing, not from the 3D model. It is also what gets checked before anything is cut.",
      do: [
        "Open your Mounting plate document and the Plate Part Studio.",
        "Right-click the part in the Parts list and choose Create drawing of Plate.",
        "Pick an ANSI A template in inches and press OK. A new Drawing tab opens.",
        "Copy the address of the Drawing tab and paste it below.",
      ],
      checkedBy: "Vantage looks for a Drawing tab in your document.",
      check: { kind: "onshape-tab", tab: "DRAWING" },
    },
    {
      id: "views",
      title: "Place three views",
      why: "A front view shows the outline and holes; side and top views show the thickness. Together nobody has to guess.",
      do: [
        "If no view is on the sheet yet, click the sheet to place the Front view.",
        "Projected view turns on by itself: move the mouse to the right of the Front view and click to place a side view, then move above or below it and click for the top view.",
        "Press Esc when you have three views.",
      ],
      checkedBy: "Vantage reads the Drawing's views and counts at least 3.",
      check: { kind: "onshape-drawing", minViews: 3 },
      links: [HELP("Projected view", "Drawing/projected_view.htm")],
    },
    {
      id: "dimensions",
      title: "Dimension the size, the holes and the thickness",
      why: "Anything without a dimension gets made “about right”. Four dimensions are enough to make this plate.",
      do: [
        "Press Dimension (d). Click the left edge, then the right edge of the Front view, then click to place the 6 in width.",
        "Do the same for the 4 in height.",
        "Dimension one hole's center from the nearest edge (hover the hole and click its center).",
        "In a side view, dimension the 0.25 in thickness.",
      ],
      checkedBy:
        "Vantage asks Onshape for a copy of the drawing (nothing is added to your document) and counts the dimensions still attached to an edge. It can take up to 15 seconds.",
      check: { kind: "onshape-drawing", minViews: 3, minDimensions: 4 },
      links: [HELP("Drawing dimensions", "Drawing/drawing_-_dimension.htm")],
    },
  ],
};

/* ------------------------------------------------------------ 5. COTS parts */

const ONSHAPE_COTS: GuidedTrack = {
  id: "onshape-cots",
  title: "COTS parts: a motor mount from a parts library",
  summary:
    "Real robots are built around parts you buy: motors, bearings, bolts. You insert a motor from an FRC parts library (MKCad or the vendor's own document), derive it into a Part Studio to design a plate around it, and bolt it together with Standard content. Vantage checks where each part came from and how it is mated.",
  time: "About 90 minutes",
  audience: "Students who finished Your first assembly.",
  steps: [
    connectStep(),
    {
      id: "assembly",
      title: "Start a “Motor mount” document",
      do: [
        "Create a new document called “Motor mount – your name”.",
        "Press + at the bottom-left and choose Create Assembly. Rename the Assembly tab Motor mount.",
        "Copy the address of the Assembly tab and paste it below.",
      ],
      checkedBy: "Vantage looks for an Assembly tab called Motor mount.",
      check: { kind: "onshape-tab", tab: "ASSEMBLY", name: "Motor mount" },
    },
    {
      id: "motor",
      title: "Insert a motor from a parts library",
      why: "Vendors publish exact CAD of their parts. Using it means your holes match the real motor.",
      do: [
        "In Motor mount press Insert parts and assemblies (i) and choose Other documents.",
        "Search for the library: MKCad is the community FRC library; REV, CTR Electronics and WCP publish their own Onshape documents. Ask a lead for your team's library link if the search finds nothing.",
        "Open the motor your team uses (for example Kraken X60 or NEO Vortex), click it and click in the view to place it. Close the dialog.",
      ],
      checkedBy: "Vantage reads the Assembly and looks for a part that comes from another document (not Standard content).",
      check: { kind: "onshape-assembly", minInstances: 1, fromOtherDocuments: 1 },
      links: [HELP("Insert parts and assemblies", "Assembly/insert_parts_and_assemblies.htm")],
    },
    {
      id: "fix",
      title: "Fix the motor",
      do: ["Right-click the motor in the Instances list and choose Fix."],
      checkedBy: "Vantage checks the motor is still there and something is fixed.",
      check: { kind: "onshape-assembly", minInstances: 1, fromOtherDocuments: 1, needsFixed: true },
    },
    {
      id: "derive",
      title: "Derive the motor into the Part Studio and design a plate on it",
      why: "Derived brings the motor's shape into your Part Studio, so the plate's holes come from the real motor face, not from a datasheet you typed wrong.",
      do: [
        "Open the Part Studio tab and press Derived on the toolbar.",
        "Choose Other documents, find the same motor, pick the motor part and press the green check.",
        "Sketch on the motor's mounting face. Press Use (u) and click the motor's bolt holes and the center bore to copy them into the sketch. Draw a rectangle around them and press the green check.",
        "Extrude the plate 0.25 in away from the motor.",
      ],
      checkedBy: "Vantage looks for a Derived feature and an extrude in the Part Studio, both with no errors.",
      check: {
        kind: "onshape-part-features",
        expect: [
          { featureType: "importDerived", label: "a Derived feature" },
          { featureType: "extrude", label: "an extrude" },
        ],
      },
    },
    {
      id: "mate-plate",
      title: "Put the plate on the motor",
      do: [
        "Back in Motor mount, insert your plate with Insert parts and assemblies (i) → Current document → your Part Studio → the plate.",
        "Press Fastened mate. Click the center dot of the motor's center bore on its face, then the matching dot on the plate. Press the green check.",
      ],
      checkedBy: "Vantage looks for at least 2 instances and a Fastened mate.",
      check: {
        kind: "onshape-assembly",
        minInstances: 2,
        fromOtherDocuments: 1,
        mates: [{ mateType: "FASTENED", label: "a Fastened mate" }],
      },
    },
    {
      id: "bolts",
      title: "Bolt it with Standard content",
      why: "A bolt list comes straight out of the Assembly when the bolts are real Standard content parts.",
      do: [
        "Press Insert parts and assemblies (i), choose Standard content and search socket head.",
        "Pick the screw size your motor uses (Kraken X60: #10-32; NEO Vortex: M3 × 0.5) and a length that goes through the plate. Place two.",
        "Fasten each screw into a motor hole with Fastened mate, head against the plate.",
      ],
      checkedBy: "Vantage counts Standard content parts (at least 2) and Fastened mates (at least 3).",
      check: {
        kind: "onshape-assembly",
        minInstances: 4,
        standardContent: 2,
        mates: [{ mateType: "FASTENED", min: 3, label: "Fastened mates" }],
      },
    },
  ],
};

/* ------------------------------------------------------------ 6. Belt layout */

const ONSHAPE_BELT_LAYOUT: GuidedTrack = {
  id: "onshape-belt-layout",
  title: "A belt layout driven by variables",
  summary:
    "Lay out an 18T to 36T HTD 5 mm belt stage the way FRC gearboxes are designed: pitch circles set by variables, the center distance set by a variable, and a configuration that switches between two real belt lengths. Vantage checks the variables, that the sketch uses them, and that every belt size rebuilds.",
  time: "About 90 minutes",
  audience: "Students who finished Your first Onshape part.",
  steps: [
    connectStep(),
    {
      id: "variables",
      title: "Make three variables",
      why: "Pulley sizes and center distance are the numbers that change when you pick a different belt. Variables let you change them in one place.",
      do: [
        "Create a document called “Belt layout – your name” and open its Part Studio.",
        "Press Variable on the toolbar. Name driverPD, type Length, value 1.128 in (the pitch diameter of an 18 tooth, 5 mm pulley). Press the green check.",
        "Add drivenPD = 2.256 in (36 tooth) and centerDistance = 5.186 in the same way.",
        "Open the Variable table on the right side to see all three. Copy the Part Studio's address and paste it below.",
      ],
      checkedBy: "Vantage looks for variables named driverPD, drivenPD and centerDistance. Names must match exactly.",
      check: { kind: "onshape-variable", names: ["driverPD", "drivenPD", "centerDistance"], where: "partstudio" },
      links: [HELP("Variable table", "variable_table.htm")],
    },
    {
      id: "pitch-circles",
      title: "Sketch the two pitch circles from the variables",
      why: "When the sketch is driven by variables, changing the belt changes the layout with no redrawing.",
      do: [
        "Press Sketch and click Front.",
        "Draw a circle on the origin and a second circle to its right. Make both construction (select them and press q).",
        "Press Dimension (d): set the first circle's diameter to #driverPD, the second to #drivenPD, and the distance between the centers to #centerDistance.",
        "Select the two circle centers and press Horizontal, then press the green check.",
      ],
      checkedBy: "Vantage reads the sketch and looks for 2 circles whose dimensions use #driverPD, #drivenPD and #centerDistance.",
      check: { kind: "onshape-sketch", minCircles: 2, usesVariables: ["driverPD", "drivenPD", "centerDistance"] },
    },
    {
      id: "belt",
      title: "Draw the belt path",
      do: [
        "Edit the sketch. Draw a line across the top of both circles and one across the bottom.",
        "Press Tangent and click each line with each circle, so both lines touch both circles.",
        "Press the green check. The lines are the belt; they follow the circles when a variable changes.",
      ],
      checkedBy: "Vantage looks for a sketch with 2 circles and at least 2 lines.",
      check: { kind: "onshape-sketch", minCircles: 2, minLines: 2 },
    },
    {
      id: "plate",
      title: "Make the gearbox plate with bearing holes",
      do: [
        "Sketch on Front again. Draw a rectangle around both circles with 0.75 in of room, and a 1.125 in circle on each pulley center (the outside of a 1/2 in hex bearing).",
        "Extrude the region between the rectangle and the two circles 0.25 in. The holes come out of the plate.",
      ],
      checkedBy: "Vantage looks for an extrude with no errors.",
      check: { kind: "onshape-part-features", expect: [{ featureType: "extrude", label: "an extrude" }] },
    },
    {
      id: "configuration",
      title: "Switch belts with a configuration",
      why: "Belts come in fixed lengths, so the center distance must match one. A configuration keeps each real belt as a row you can pick.",
      do: [
        "Open the Configuration panel on the right side and press Configure Part Studio, then choose List. Name the list Belt.",
        "Type 80T (400 mm) in the first row and 90T (450 mm) in the second.",
        "Click the centerDistance Variable in the feature list, then click its value so it becomes a column in the table.",
        "Type 5.186 in for 80T and 6.175 in for 90T (from the belt length formula for these pulleys).",
      ],
      checkedBy: "Vantage reads the configuration: a List with at least 2 rows that changes #centerDistance.",
      check: { kind: "onshape-configuration", minOptions: 2, configuresVariable: "centerDistance" },
      links: [HELP("Configurations", "PartStudio/part_studio_and_assembly_configurations.htm")],
    },
    {
      id: "rebuild",
      title: "Check both belts rebuild",
      why: "A layout that breaks in one configuration breaks the day someone picks that belt.",
      do: [
        "Pick 90T in the Configuration panel and watch the plate grow. Pick 80T again.",
        "Fix anything that turns red, then press Check my work.",
      ],
      checkedBy: "Vantage rebuilds the Part Studio in every row of the Belt list and looks for errors.",
      check: { kind: "onshape-rebuild", minFeatures: 6, everyConfiguration: true },
    },
  ],
};

/** Onshape tracks, each step checked by reading the student's own document through the Onshape API. */
export const ONSHAPE_TRACKS: GuidedTrack[] = [
  ONSHAPE_FIRST_PART,
  ONSHAPE_FIRST_ASSEMBLY,
  ONSHAPE_SHEET_METAL,
  ONSHAPE_DRAWING,
  ONSHAPE_COTS,
  ONSHAPE_BELT_LAYOUT,
];
