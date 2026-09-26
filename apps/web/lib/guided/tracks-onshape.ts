import type { GuidedTrack } from "./types";

/* ------------------------------------------------------------ Onshape: first part */

const ONSHAPE_FIRST_PART: GuidedTrack = {
  id: "onshape-first-part",
  title: "Your first Onshape part, checked step by step",
  summary:
    "A mounting plate from a blank Part Studio: sketch, extrude, holes, fillets, a thickness variable and a material. After each step Vantage reads your Part Studio in Onshape and tells you whether it is there.",
  time: "About 90 minutes",
  audience: "New CAD students. No CAD experience needed.",
  steps: [
    {
      id: "connect",
      title: "Connect your Onshape account",
      why: "Vantage checks your work by reading your own Part Studio, so it needs your permission to read it. It only reads.",
      do: [
        "Make a free Onshape Education account at onshape.com if you do not have one (use your school email).",
        "In Vantage open CAD → Connections and press Connect Onshape, then approve the read access Onshape asks for.",
        "Come back to this page and press Check.",
      ],
      checkedBy: "Vantage asks Onshape whether your account is connected.",
      check: { kind: "onshape-connected" },
      links: [{ label: "CAD connections", href: "/cad/connections" }],
    },
    {
      id: "part-studio",
      title: "Make a document and name the Part Studio",
      why: "One document per mechanism keeps a robot's CAD findable. The Part Studio is where parts are drawn.",
      do: [
        "In Onshape press Create → Document and name it “Mounting plate – your name”.",
        "Right-click the Part Studio 1 tab at the bottom, choose Rename and call it “Plate”.",
        "Copy the address from the browser's address bar while the Plate tab is open and paste it below.",
      ],
      checkedBy: "Vantage opens the Part Studio at that address. Any Part Studio you can open passes; it may be empty.",
      check: { kind: "onshape-features", expect: [], anyOf: false },
    },
    {
      id: "sketch",
      title: "Sketch a 6 × 4 inch rectangle on the Top plane",
      why: "Every part starts as a 2D sketch. Dimensions make it exact instead of “about right”.",
      do: [
        "Press Sketch, then click the Top plane.",
        "Pick the Center-point rectangle, click the origin, and drag out a rectangle.",
        "Press D (Dimension) and set the width to 6 in and the height to 4 in. The lines turn black when fully defined.",
        "Press the green check to finish the sketch.",
      ],
      checkedBy: "Vantage looks for a sketch in the Part Studio.",
      check: { kind: "onshape-features", expect: [{ featureType: "newSketch", label: "a sketch" }] },
    },
    {
      id: "extrude",
      title: "Extrude it into a 0.25 inch plate",
      do: [
        "Press Extrude and select the rectangle's face.",
        "Set the depth to 0.25 in and press the green check. You now have a solid part.",
      ],
      checkedBy: "Vantage looks for an extrude.",
      check: { kind: "onshape-features", expect: [{ featureType: "extrude", label: "an extrude" }] },
    },
    {
      id: "holes",
      title: "Add four #10 clearance holes",
      why: "Holes placed from dimensions line up with the real frame; holes placed by eye do not.",
      do: [
        "Sketch on the top face of the plate and draw one point 0.5 in in from two edges.",
        "Use the Hole tool on that point: Simple, #10 clearance (0.201 in), Through all.",
        "Pattern it to the other three corners with Linear pattern, or place four points and one Hole.",
      ],
      checkedBy: "Vantage looks for a Hole feature, or a second extrude that cuts material away.",
      check: {
        kind: "onshape-features",
        anyOf: true,
        expect: [
          { featureType: "hole", label: "a Hole" },
          { featureType: "extrude", min: 2, label: "a second extrude (a cut)" },
        ],
      },
    },
    {
      id: "fillet",
      title: "Round the four corners",
      do: ["Press Fillet, click the four vertical corner edges, set 0.25 in and press the green check."],
      checkedBy: "Vantage looks for a fillet.",
      check: { kind: "onshape-features", expect: [{ featureType: "fillet", label: "a fillet" }] },
    },
    {
      id: "variable",
      title: "Make the thickness a variable",
      why: "When the plate goes from 0.25 in to 0.125 in, one number changes instead of hunting through features.",
      do: [
        "Press Variable (the # icon), name it thickness and set it to 0.25 in. Drag it to the top of the feature list.",
        "Edit the extrude and type #thickness as the depth.",
      ],
      checkedBy: "Vantage looks for a Variable feature.",
      check: { kind: "onshape-features", expect: [{ featureType: "assignVariable", label: "a Variable" }] },
    },
    {
      id: "material",
      title: "Give the part a material",
      why: "Weight budgets and center-of-mass checks come from the material. A part with no material weighs nothing.",
      do: [
        "Right-click the part in the Parts list, choose Assign material, and pick Aluminum 6061.",
        "Check the mass with the Mass properties tool (the scale icon): about 0.3 lb for this plate.",
      ],
      checkedBy: "Vantage reads the part's mass from Onshape. It passes when Onshape reports a mass.",
      check: { kind: "onshape-mass" },
    },
  ],
};

/** Onshape tracks, each step checked by reading the student's own document through the Onshape API. */
export const ONSHAPE_TRACKS: GuidedTrack[] = [ONSHAPE_FIRST_PART];
