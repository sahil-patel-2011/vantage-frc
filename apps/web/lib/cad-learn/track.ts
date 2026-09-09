/**
 * The CAD learning track: single part → multi-part → assemblies, ending in a
 * part Vantage grades against a reference.
 *
 * Same shape as the programming guide in `lib/dev-setup/track.ts`, and for the
 * same reason: a new designer needs three separate things about every tool —
 * what it is, HOW to use it, and WHEN you actually reach for it — and prose
 * blurs them together. `why` is kept apart from `steps` throughout.
 *
 * SOURCING
 *
 * "thecadvideotutor" was suggested as a source. It cannot be used: the domain
 * thecadvideotutor.com does not resolve (DNS failure) and the YouTube handle
 * returns 404. It is deliberately not linked, and there is a test pinning that
 * so it cannot be added back from memory.
 *
 * The backbone is Onshape's own free official material, which is both correct
 * and permanently maintained: the Learning Center, the Education programme, the
 * product help, and the community forum. We LINK to it. We never copy anyone's
 * tutorial text — the instructions here are written for this audience (an FRC
 * mechanical student in their first season) and the depth lives behind the
 * links.
 *
 * EVERY URL HERE WAS VERIFIED TO RETURN 200 AND TO BE THE PAGE IT CLAIMS.
 *
 * That second half matters more than it sounds. cad.onshape.com/help serves
 * HTTP 200 for ANY path under /help/Content/ — a made-up topic renders the
 * generic "Onshape Help" landing page with a 200. So a status check alone
 * proves nothing there. Each help link below was verified by fetching it and
 * reading the <title>: a real topic returns its own title ("Extrude", "Mates",
 * "Mass Properties Tool"), while a dead path returns "Onshape Help". Two
 * plausible paths were rejected that way (Content/planes.htm and
 * Content/massproperties.htm both 200'd and were both the fallback page) and
 * replaced with the canonical ones. Do not add a link from memory.
 */

export type LessonLink = {
  label: string;
  href: string;
  /** The one link to open first. Rendered as the primary action. */
  primary?: boolean;
};

export type Lesson = {
  id: string;
  title: string;
  /** When you actually reach for this on a real robot. Kept separate from how. */
  why: string;
  /** What to do, one line per action. */
  steps: string[];
  /**
   * Alternative ways to do the same thing, each its own tab — the shape the
   * programming guide uses for install methods. Here it is for the genuinely
   * different routes through one job (Education plan vs free plan; sketching a
   * slot two ways), where showing both at once is confusing and showing one
   * leaves half the team stuck.
   */
  methods?: Array<{ label: string; lines: string[]; note?: string }>;
  /** The thing you build. Every lesson makes something. */
  practice: string;
  /** How you know it actually worked. */
  verify: string;
  links: LessonLink[];
  minutes: number;
  tip?: string;
  warning?: string;
  /**
   * True when this lesson ends in a part Vantage can auto-grade against a
   * reference. Grading needs a lead to have bound a reference part first; the
   * page says so rather than pretending.
   */
  gradable?: boolean;
};

export type Unit = {
  id: string;
  title: string;
  blurb: string;
  lessons: Lesson[];
};

const HELP = "https://cad.onshape.com/help/Content";

export const CAD_TRACK: Unit[] = [
  {
    id: "start",
    title: "1 · Getting in",
    blurb:
      "Onshape runs in a browser, so there is nothing to install and nothing that only works on one laptop in the shop. Get an account and learn to move around before you try to draw anything.",
    lessons: [
      {
        id: "account",
        title: "Get an Onshape account",
        why:
          "Everything else needs one. Use the Education plan if your team qualifies — it is free and, unlike the free plan, your documents are private. On the free plan every document you make is public and anyone can copy it, which is fine for learning and not fine for your robot.",
        steps: [
          "Sign up with an email you will still have next season.",
          "Pick the plan that matches your situation using the tabs below.",
          "Open Onshape and let it finish first-run setup.",
          "Join your team's Onshape workspace if you have one — ask your CAD lead, do not create a second one.",
        ],
        methods: [
          {
            label: "Education plan",
            lines: [
              "Go to onshape.com/en/education and start the education sign-up",
              "Use your school email address",
              "Wait for the approval email, then sign in at cad.onshape.com",
            ],
            note:
              "Private documents, and the plan FRC teams should be on. Approval is not instant — start this the week before you need it, not the night before.",
          },
          {
            label: "Free plan",
            lines: ["Go to cad.onshape.com/signup", "Sign up and sign in"],
            note:
              "Works immediately, but every document is PUBLIC. Fine for these lessons. Do not put your robot in it.",
          },
        ],
        practice: "Create one document called 'CAD lessons — your name'. It will hold everything you build here.",
        verify: "You can sign in at cad.onshape.com and open a document you created.",
        warning:
          "On the free plan, everything you make is visible to the whole internet, including your team's competitive design work. Check which plan you are on before you model anything that is not a lesson.",
        links: [
          { label: "Onshape for education", href: "https://www.onshape.com/en/education", primary: true },
          { label: "Sign up", href: "https://cad.onshape.com/signup" },
          { label: "What the free plan includes", href: "https://www.onshape.com/en/products/free" },
        ],
        minutes: 20,
      },
      {
        id: "interface",
        title: "Move around without touching anything",
        why:
          "Half of 'I cannot do this' in week one is actually 'I lost my part and I do not know which way is up'. Ten minutes spinning an empty document costs less than an hour of being lost mid-lesson.",
        steps: [
          "Open your document. The tabs along the bottom are the pieces of the document — one Part Studio is one tab.",
          "Learn the three mouse moves: rotate, pan, and zoom. Do each of them twenty times until you stop thinking about it.",
          "Find the view cube in the corner and click its faces — that is how you get back to a known orientation when you are lost.",
          "Right-click on things. Onshape puts most of what you need in context menus, and finding them by right-clicking is faster than hunting the toolbar.",
          "Find the two lists on the left: the Feature list (the recipe that built the part) and the Parts list (what came out).",
        ],
        practice:
          "Open a public Onshape document from the forum or the Learning Center, spin it around, and find one feature in its Feature list. You are reading, not editing.",
        verify: "You can get back to an isometric view from any orientation without thinking about it.",
        tip:
          "The Feature list is the single most useful thing on screen and beginners ignore it for weeks. It is the ordered recipe that made the part. If a part is wrong, the mistake is a line in that list — not something you have to redraw.",
        links: [
          { label: "Getting started with Onshape", href: `${HELP}/Home/getting_started_with_onshape.htm`, primary: true },
          { label: "Context menus (right-click)", href: `${HELP}/Home/context_menus.htm` },
          { label: "Onshape Learning Center (free courses)", href: "https://learn.onshape.com" },
        ],
        minutes: 25,
      },
      {
        id: "units",
        title: "Units, before they bite you",
        why:
          "FRC lives in inches and most of CAD defaults to millimetres. Every team loses a part to this at least once — a bracket modelled 25.4x too big, discovered at the laser cutter. Set units once and learn how to type the other one when you need it.",
        steps: [
          "Open the document's workspace units and set them to what your team actually works in. Ask your CAD lead; do not guess.",
          "Learn that you can type a unit into any number field. If the document is in mm and you type an inch value with 'in' after it, Onshape converts it.",
          "Decide with your team which unit the ROBOT is in, and write it in your team's notes. Mixed-unit assemblies are the worst kind of wrong, because everything looks fine.",
        ],
        practice: "In a sketch, type the same length twice — once in mm and once in inches — and confirm they land on the same place.",
        verify: "You can state your team's working unit from memory, and you can enter a length in the other one.",
        links: [
          { label: "Typing units into number fields", href: `${HELP}/Home/numeric_fields.htm`, primary: true },
        ],
        minutes: 15,
      },
    ],
  },
  {
    id: "sketching",
    title: "2 · Sketching",
    blurb:
      "A sketch is a 2D outline on a flat surface. Almost every solid you will ever make starts as one. This unit is worth doing slowly — a sloppy sketch produces a part that changes shape when someone else edits it.",
    lessons: [
      {
        id: "sketch-basics",
        title: "Your first sketch",
        why:
          "Every extrude, every revolve, every cut starts here. When someone says 'can you make the mounting plate 10mm longer', what you actually change is a number in a sketch.",
        steps: [
          "Start a sketch and pick a plane to draw on. Onshape gives you three to start with: Top, Front and Right.",
          "Draw a rectangle. Do not worry about the size yet.",
          "Add dimensions to the rectangle so it is a specific size.",
          "Notice the sketch entities change colour once they are fully defined. That colour change is the whole point of the next lesson.",
          "Close the sketch. It appears in the Feature list — that is your recipe getting its first line.",
        ],
        methods: [
          {
            label: "Rectangle tool",
            lines: ["Sketch → Rectangle → click two opposite corners", "Dimension → click each side → type the length"],
            note: "The straightforward way. Use this until sketching stops feeling awkward.",
          },
          {
            label: "Lines + constraints",
            lines: ["Sketch → Line → draw four segments and close the loop", "Add horizontal / vertical constraints", "Dimension the two lengths"],
            note:
              "More work for a rectangle, but it is how you draw a shape the rectangle tool cannot make. Worth doing once so the constraint tools are not new to you later.",
          },
        ],
        practice: "Draw a 100mm x 60mm rectangle centred on the origin. Centred on the origin, not near it.",
        verify: "Your sketch closes, appears in the Feature list, and reopening it shows the dimensions you typed.",
        tip:
          "Attach your first sketch to the origin. A sketch floating in space works fine right up until someone edits an earlier feature, and then it moves and takes the whole part with it.",
        links: [
          { label: "Sketch tools", href: `${HELP}/Sketch/sketch_tools.htm`, primary: true },
          { label: "Onshape Learning Center course catalog", href: "https://learn.onshape.com/catalog" },
        ],
        minutes: 45,
      },
      {
        id: "constraints",
        title: "Fully defined, and why it matters",
        why:
          "An under-defined sketch is the single biggest source of 'it worked yesterday'. Geometry with nothing holding it in place will move when anything upstream changes. Fully defining a sketch is how you make a part that survives being edited by someone else at 11pm.",
        steps: [
          "Draw a shape and watch which entities stay in the 'not yet defined' colour.",
          "Add relations — horizontal, vertical, coincident, equal, tangent — before you add dimensions. Relations describe intent; dimensions describe size.",
          "Add dimensions until nothing is left undefined.",
          "Drag a line. If anything moves, the sketch is not fully defined yet.",
          "Do it again on a shape with a circle and a slot in it.",
        ],
        practice:
          "Make a fully defined sketch of a plate outline with two bolt holes, where the holes are positioned relative to the plate edges rather than typed as absolute coordinates.",
        verify: "You can drag any entity in the sketch and nothing moves.",
        tip:
          "Relations first, dimensions second. If you dimension everything and add no relations, the sketch is technically defined and still describes none of your intent — so the next person changing a number gets a shape you would not recognise.",
        warning:
          "Do not fix an under-defined sketch by adding more dimensions until it stops moving. That is how you end up with a sketch that cannot be changed at all, which is a different and worse problem.",
        links: [{ label: "Sketch tools and relations", href: `${HELP}/Sketch/sketch_tools.htm`, primary: true }],
        minutes: 45,
      },
    ],
  },
  {
    id: "solids",
    title: "3 · Turning sketches into solids",
    blurb:
      "Two features do most of the work in FRC: extrude and revolve. Everything else in this unit is a refinement of them.",
    lessons: [
      {
        id: "planes",
        title: "Planes and datums",
        why:
          "You will very quickly need to sketch on something that does not exist yet — a face 12mm above another face, an angled surface for a mounting bracket. A plane is the flat reference you create so you have somewhere to draw. This is the lesson that unlocks parts more complicated than a box.",
        steps: [
          "Look at the three default planes in the Feature list. Every part starts on one of them.",
          "Create a new plane offset from an existing one by a distance.",
          "Create a plane at an angle to an existing one.",
          "Sketch on your new plane and extrude from it, so you can see it behaves like any other flat surface.",
          "Sketch on a FACE of an existing part instead of a plane, and notice this is the same idea.",
        ],
        practice: "Build a part with a base plate and a tab that sits 20mm above it and 30 degrees off vertical.",
        verify: "You can change the offset distance of your plane and watch the geometry above it move with it.",
        tip:
          "Prefer sketching on a plane over sketching on a face when the face might get filleted later. Fillet a face and the sketch that lived on it can lose its home; a plane is still there.",
        links: [{ label: "Plane", href: `${HELP}/PartStudio/plane.htm`, primary: true }],
        minutes: 40,
      },
      {
        id: "extrude",
        title: "Extrude — add and remove",
        why:
          "The workhorse. Extrude adds material by pushing a sketch into 3D, and removes it by pushing a sketch through something that already exists. Every bolt hole and every lightening pocket on your robot is an extruded cut.",
        steps: [
          "Extrude your rectangle sketch to a thickness. That is a solid part.",
          "Sketch a circle on its top face and extrude it as a REMOVE to make a hole.",
          "Try the symmetric option so the material grows both ways from the sketch — this is what you want when you sketch on a centre plane.",
          "Try 'up to face' instead of a typed depth, and see it follow the geometry when the geometry changes.",
          "Look at your Feature list: it now reads like a recipe someone else could follow.",
        ],
        practice: "Turn your 100x60 plate into a 6mm thick plate with four 5mm holes, one near each corner.",
        verify: "Changing the plate thickness in the first extrude leaves the holes where they should be.",
        tip:
          "'Up to face' instead of a typed number is one of the habits that separates a part that updates cleanly from one that breaks. Type a number when the number is the requirement; pick a face when the requirement is 'flush with that'.",
        links: [{ label: "Extrude", href: `${HELP}/PartStudio/extrude.htm`, primary: true }],
        minutes: 45,
      },
      {
        id: "revolve",
        title: "Revolve",
        why:
          "Anything round about an axis — a spacer, a shaft, a pulley blank, a wheel hub. Drawing the side profile and spinning it is far less work than trying to extrude a round thing, and it gives you a shape that is correct by construction.",
        steps: [
          "Sketch the HALF profile of a round part, with one straight edge on the axis you want to spin about.",
          "Revolve it 360 degrees about that axis.",
          "Try a partial revolve — less than 360 — and see what you get.",
          "Combine: revolve a shaft, then extrude-remove a flat on one side.",
        ],
        practice: "Model a shaft spacer: an outer diameter, a bore through the middle, and a length.",
        verify: "Changing the profile sketch changes the revolved part, and the part has no seam or gap where it closed.",
        warning:
          "If the revolve fails, the usual cause is that your profile crosses the axis. The profile has to sit entirely on one side of it.",
        links: [{ label: "Revolve", href: `${HELP}/PartStudio/revolve.htm`, primary: true }],
        minutes: 35,
      },
      {
        id: "fillets-chamfers",
        title: "Fillets and chamfers",
        why:
          "A fillet is a rounded edge; a chamfer is a cut corner. They are not decoration. A sharp inside corner is where a part cracks under load, and a sharp outside corner is what cuts someone reaching into the robot at competition. They also change mass — which is why they matter to the grading later in this track.",
        steps: [
          "Fillet the outside corners of your plate.",
          "Fillet an inside corner where two faces meet at 90 degrees, and notice the part immediately looks less like it was made by a beginner.",
          "Chamfer the edge of a hole so a bolt head sits flat.",
          "Change one fillet radius and watch everything downstream update.",
          "Delete a fillet and re-add it at the END of your feature list. Fillets belong last.",
        ],
        practice: "Add a 5mm fillet to the outside corners of your plate and a 1mm chamfer to both ends of each hole.",
        verify: "Every corner you meant to soften is soft, and the feature list still rebuilds without errors.",
        tip:
          "Fillets last, always. Put a fillet early in the feature list and every later sketch that touches that face becomes fragile — a small change upstream and the sketch has nothing to attach to.",
        links: [
          { label: "Fillet", href: `${HELP}/PartStudio/fillet.htm`, primary: true },
          { label: "Chamfer", href: `${HELP}/PartStudio/chamfer.htm` },
        ],
        minutes: 35,
      },
    ],
  },
  {
    id: "part-studios",
    title: "4 · Part Studios and material",
    blurb:
      "A Part Studio is Onshape's big idea and the thing that is genuinely different from other CAD. One tab can hold several parts that were all cut from the same sketches — which is exactly how a real gearbox plate and its spacers relate to each other.",
    lessons: [
      {
        id: "part-studio",
        title: "More than one part in one studio",
        why:
          "When two parts have to line up — a plate and the standoff that bolts to it — modelling them in the same Part Studio from the same sketch means they cannot drift apart. Change the hole spacing once and both parts follow. This is the single biggest reason FRC teams use Onshape.",
        steps: [
          "In one Part Studio, extrude a second, separate solid as NEW rather than adding to the first.",
          "Look at the Parts list: two entries, one studio.",
          "Sketch on a face of part one and extrude a feature on part two from it, so the two are driven by the same geometry.",
          "Rename both parts to what they actually are. 'Part 1' and 'Part 2' will cost someone an hour in March.",
        ],
        practice: "Model a plate and a matching spacer in one Part Studio, where the spacer's bore comes from the plate's hole sketch.",
        verify: "Changing the hole diameter in the shared sketch changes BOTH parts.",
        links: [
          { label: "Part Studios", href: `${HELP}/PartStudio/part_studios.htm`, primary: true },
          { label: "The full feature toolbar", href: `${HELP}/PartStudio/feature_tools.htm` },
        ],
        minutes: 45,
      },
      {
        id: "material",
        title: "Assign a material — cast iron for this track",
        why:
          "Until a part has a material, Onshape reports no mass for it at all, because it has no density to work with. Assigning material is what turns a shape into something you can weigh, and weight is the thing FRC teams run out of first. Every lesson part in this track is graded on CAST IRON — not because a robot is made of cast iron, but because the grader compares your part with the reference part and the comparison only means anything if both are on the same material.",
        steps: [
          "Open the Parts list, right-click your part, and assign a material.",
          "Choose CAST IRON. Every part you submit for grading in this track must be on cast iron.",
          "Assign it to the PART, not just to the studio — the grader reads the part's own mass.",
          "Check the part now reports a mass in the mass properties panel.",
        ],
        practice: "Assign cast iron to every part you have made so far.",
        verify: "Your part reports a non-zero mass. If it reports nothing, no material is assigned.",
        warning:
          "If your part has no material, the grader will tell you it cannot read a mass and will grade nothing. It will not guess a density and it will not give you a score — a made-up number would be worse than no number.",
        tip:
          "Cast iron is heavy, so lesson parts weigh a lot more than the real thing would in aluminium. That is deliberate: the point is that your part and the reference part are on the SAME material, not that the number is realistic.",
        links: [
          { label: "Customizing part materials", href: `${HELP}/PartStudio/customizing_part_materials.htm`, primary: true },
        ],
        minutes: 20,
      },
      {
        id: "mass-properties",
        title: "Read your own mass properties",
        why:
          "This is the number that decides whether your subsystem fits in the weight budget, and it is the number this track grades you on. Learning to read it yourself means you find your own mistakes before anyone else does.",
        steps: [
          "Open the mass properties panel for your Part Studio.",
          "Read the mass. Confirm the material is what you think it is.",
          "Find the moments of inertia. Inertia is how hard the part is to spin up — it is why a heavy roller at the end of an arm is a much bigger problem than the same weight near the pivot.",
          "Change one dimension by 10% and watch how much MORE the inertia changes than the mass does. That relationship is why this track grades both.",
          "Use the measure tool to check a distance you thought you knew.",
        ],
        practice: "Write down your plate's mass, change its thickness by 10%, and predict the new mass before you look.",
        verify: "You can find the mass and the moments of inertia of any part without hunting for the panel.",
        tip:
          "Mass scales with how much material there is. Inertia scales with how much material AND how far it sits from the axis — so moving material outward changes inertia far more than it changes mass. That is exactly what the grader's two percentages are telling you apart.",
        links: [
          { label: "Mass Properties tool", href: `${HELP}/View/mass_properties_tool.htm`, primary: true },
          { label: "Measure tool", href: `${HELP}/View/measure_tool.htm` },
        ],
        minutes: 30,
      },
    ],
  },
  {
    id: "multi-part",
    title: "5 · Multi-part and assemblies",
    blurb:
      "One part is a shape. A robot is parts that have to fit each other, move against each other, and not collide. This is where CAD stops being drawing and starts being engineering.",
    lessons: [
      {
        id: "in-context",
        title: "In-context design",
        why:
          "The honest way to model a bracket that has to bolt onto something else: design it while looking at the thing it bolts to, taking its dimensions from that geometry rather than measuring and retyping them. Retyped dimensions go stale the moment someone edits the other part, and nobody notices until it is machined.",
        steps: [
          "Put two parts into an assembly and position them.",
          "Create an in-context Part Studio from that assembly.",
          "Sketch on a face of one part and use it to drive a feature on the other.",
          "Change the first part and update the context, then watch the second part follow.",
          "Read the linked page on what a context actually is before you rely on this — an out-of-date context is a real trap and it is better to meet it here than on a competition robot.",
        ],
        practice: "Model a bracket whose bolt pattern is taken from the holes in a plate you already made, not typed in.",
        verify: "Moving a hole in the first part moves the matching hole in the bracket after you update the context.",
        warning:
          "An in-context feature is frozen to a snapshot of the assembly until you update it. That is a feature, not a bug — but if you forget it, your bracket quietly describes where the holes USED to be.",
        links: [
          { label: "Modeling in-context", href: `${HELP}/Assembly/modeling_in_context.htm`, primary: true },
          { label: "Part Studios", href: `${HELP}/PartStudio/part_studios.htm` },
        ],
        minutes: 50,
      },
      {
        id: "assemblies",
        title: "Assemblies",
        why:
          "An assembly is where you find out whether it fits. Parts that were each fine on their own can overlap, collide when they move, or need a bolt where there is no room for a wrench. Better to learn that on a screen in January.",
        steps: [
          "Create an assembly tab and insert your parts into it.",
          "Fix the first part so it cannot move — everything else gets positioned relative to it.",
          "Insert a standard part from the standard content library rather than modelling a bolt yourself.",
          "Look at the bill of materials the assembly gives you. That is the list you will hand to whoever orders parts.",
        ],
        practice: "Assemble your plate, spacer and bracket into one assembly with the plate fixed.",
        verify: "Every part is in the assembly, one is fixed, and the bill of materials lists them all.",
        tip:
          "Do not model fasteners. Insert them from the standard content library. A hand-modelled M5 bolt is an hour you will not get back and it will be slightly wrong.",
        links: [
          { label: "Assemblies", href: `${HELP}/Assembly/assembly.htm`, primary: true },
          { label: "Bill of materials", href: `${HELP}/Assembly/bill_of_material.htm` },
        ],
        minutes: 45,
      },
      {
        id: "mates",
        title: "Mates",
        why:
          "A mate says how two parts are allowed to move relative to each other — bolted solid, free to spin, free to slide. Mating an arm properly means you can drag it through its range of motion in CAD and see it hit the frame before you build it and find out with a broken part.",
        steps: [
          "Understand mate connectors first: a mate connects two COORDINATE SYSTEMS, not two faces. Onshape infers connectors from your geometry, and you can place your own.",
          "Fasten two parts together so they move as one.",
          "Use a revolute mate so one part can spin about an axis, and drag it.",
          "Use a slider mate for something that extends.",
          "Drag your mechanism through its whole range and look for collisions.",
        ],
        practice: "Mate a bracket to a plate with a fastened mate, and mate an arm to the bracket with a revolute mate. Drag the arm.",
        verify: "The arm rotates about the axis you intended and nothing else moves when you drag it.",
        tip:
          "If a mate keeps snapping to the wrong place, the problem is almost always the mate connector, not the mate. Place an explicit mate connector where you want it rather than fighting the inferred one.",
        links: [
          { label: "Mates", href: `${HELP}/Assembly/mates.htm`, primary: true },
          { label: "Mate connectors", href: `${HELP}/PartStudio/mate_connector.htm` },
        ],
        minutes: 60,
      },
    ],
  },
  {
    id: "graded",
    title: "6 · The graded part",
    blurb:
      "Everything above is practice. This is the one you submit, and the one Vantage measures against your team's reference part.",
    lessons: [
      {
        id: "graded-bracket",
        title: "Build and submit the graded part",
        why:
          "Being able to build a specific part to a specific spec — not something roughly like it — is the difference between a student who can help and one who needs help. The grader measures two things a picture cannot: how much material you used, and where you put it.",
        steps: [
          "Get the part drawing from your CAD lead, or the lesson document they bound as the reference.",
          "Model it in ONE Part Studio, as one solid part.",
          "Assign CAST IRON to the part. The reference is on cast iron; if yours is not, both numbers will be wrong and the grader will tell you the materials do not match.",
          "Read your own mass properties first and compare them to the drawing. Find your own mistakes before you submit.",
          "Copy the Part Studio's URL from your browser — the one with /w/ and /e/ in it — and paste it into the grader on this page.",
          "Read the two percentages and the notes. Fix what they point at, then grade again. Grading again is normal and is not a penalty.",
        ],
        practice: "One part, one Part Studio, cast iron, fully-defined sketches.",
        verify:
          "The grader reports a mass difference and a moment-of-inertia difference against your team's reference part. Inside the match band on both means you built the right thing.",
        tip:
          "The two numbers tell you different things. Mass says whether you used the right AMOUNT of material. Moment of inertia says whether you put it in the right PLACE. Mass right and inertia wrong means a feature is on the wrong side or at the wrong distance from the centre — a mistake a rendered picture will never show you.",
        warning:
          "If the grader says it could not read your mass properties, it has graded nothing and given you no score. Check, in order: is your Onshape account connected to Vantage, is the document shared with that account, does the part have cast iron assigned. Nothing about a failed read is a mark against you.",
        gradable: true,
        links: [
          { label: "Mass Properties tool", href: `${HELP}/View/mass_properties_tool.htm`, primary: true },
          { label: "Customizing part materials", href: `${HELP}/PartStudio/customizing_part_materials.htm` },
        ],
        minutes: 90,
      },
      {
        id: "share-and-version",
        title: "Version it and share it",
        why:
          "A design nobody else can open is not a design. Versions are how you get back to the shape that worked after four people edited the same document at once — Onshape has no 'save', so a version is the checkpoint you actually rely on.",
        steps: [
          "Create a version of your document once the part is right, and name it something meaningful.",
          "Share the document with your CAD lead so they can actually open it.",
          "Look at the version history and go back to an earlier one to see what that does.",
          "Export the part as STEP so it can go to whoever is making it.",
        ],
        practice: "Version your graded part, share it with your lead, and export a STEP file.",
        verify: "Your lead can open the document, and the version you named appears in the version history.",
        tip:
          "There is no save button in Onshape, and that surprises everyone. Every edit is already stored. What a version gives you is a NAMED point you can get back to, which is the thing you will want at 11pm.",
        links: [
          { label: "Versioning and branching", href: `${HELP}/Document/versions_and_history.htm`, primary: true },
          { label: "Sharing and collaboration", href: `${HELP}/Collaboration/collaboration.htm` },
          { label: "Exporting files", href: `${HELP}/File/exporting_files.htm` },
        ],
        minutes: 30,
      },
    ],
  },
];

/**
 * The "I know what I want, just tell me the tool" table.
 *
 * Deliberately jobs-to-tools rather than keyboard shortcuts: Onshape's shortcut
 * set differs by platform and changes between releases, and a wrong shortcut in
 * a reference table is worse than no table. Everything here appears in context
 * above; this is the version you scan mid-session.
 */
export const CAD_REFERENCE: Array<{
  group: string;
  rows: Array<{ want: string; tool: string }>;
}> = [
  {
    group: "Making the shape",
    rows: [
      { want: "Turn a flat outline into a solid", tool: "Extrude, operation NEW" },
      { want: "Cut a hole or a pocket through something", tool: "Extrude, operation REMOVE" },
      { want: "Make something round about an axis", tool: "Revolve" },
      { want: "Follow a path with a profile", tool: "Sweep" },
      { want: "Blend between two different profiles", tool: "Loft" },
      { want: "Hollow a solid out to a wall thickness", tool: "Shell" },
      { want: "Copy a feature across the part symmetrically", tool: "Mirror" },
    ],
  },
  {
    group: "Getting somewhere to draw",
    rows: [
      { want: "Sketch at a set distance from an existing face", tool: "Plane, offset" },
      { want: "Sketch at an angle", tool: "Plane, angle" },
      { want: "Sketch directly on the part", tool: "Select the face, then Sketch" },
      { want: "Bring geometry in from another Part Studio", tool: "Derived" },
    ],
  },
  {
    group: "Finishing",
    rows: [
      { want: "Round an edge", tool: "Fillet — add it LAST in the feature list" },
      { want: "Cut a corner off an edge", tool: "Chamfer" },
      { want: "Make the part weigh something", tool: "Assign material to the part in the Parts list" },
    ],
  },
  {
    group: "Checking your work",
    rows: [
      { want: "How heavy is it", tool: "Mass properties panel" },
      { want: "How hard is it to spin up", tool: "Mass properties → moments of inertia" },
      { want: "How far apart are these two things", tool: "Measure tool" },
      { want: "Why did this part break when I changed something", tool: "Read the Feature list top to bottom" },
    ],
  },
  {
    group: "Working with other people",
    rows: [
      { want: "Save a point I can get back to", tool: "Create a version — there is no save button" },
      { want: "Let my lead open it", tool: "Share the document with their Onshape account" },
      { want: "Send it to whoever is making it", tool: "Export as STEP" },
      { want: "Two parts must keep fitting each other", tool: "Same Part Studio, or in-context design" },
    ],
  },
];

/**
 * Where to go when the track runs out — the "I am stuck and my lead has gone
 * home" links. Kept here rather than inline in the page so the link-integrity
 * test covers them too; an unchecked link in the help footer fails a student
 * just as hard as one in a lesson.
 */
export const CAD_COMMUNITY_LINKS: LessonLink[] = [
  {
    label: "Onshape Learning Center — free official courses",
    href: "https://learn.onshape.com",
    primary: true,
  },
  { label: "Course catalog", href: "https://learn.onshape.com/catalog" },
  { label: "Onshape forum — ask a question", href: "https://forum.onshape.com/discussions" },
  { label: "Onshape forum home", href: "https://forum.onshape.com" },
  { label: "Chief Delphi — the FRC community", href: "https://www.chiefdelphi.com" },
];

/** Every lesson, flattened, in track order. */
export function allLessons(): Lesson[] {
  return CAD_TRACK.flatMap((unit) => unit.lessons);
}

export function lessonById(id: string): Lesson | undefined {
  return allLessons().find((lesson) => lesson.id === id);
}

export function allLessonIds(): string[] {
  return allLessons().map((lesson) => lesson.id);
}

/** The lessons that end in a part Vantage can grade. */
export function gradableLessons(): Lesson[] {
  return allLessons().filter((lesson) => lesson.gradable);
}

export function totalCadMinutes(): number {
  return allLessons().reduce((sum, lesson) => sum + lesson.minutes, 0);
}

/** Every external link the page can show, for the link-integrity test. */
export function allCadLinks(): LessonLink[] {
  return [...allLessons().flatMap((lesson) => lesson.links), ...CAD_COMMUNITY_LINKS];
}
