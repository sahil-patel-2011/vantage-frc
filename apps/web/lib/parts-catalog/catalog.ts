// A reference catalog of the COTS parts FRC teams actually buy.
//
// This is the "what do we order" half of parts; inventory_items is the "what
// do we have" half. It is deliberately platform data in code rather than a
// table: it is the same for every team, it is versioned and reviewed in git,
// and it needs no RLS. A team's own stock, costs and locations never live here.
//
// Honesty rules:
// - No prices. Vendor prices change monthly and a stale number in a catalog is
//   a wrong number that looks authoritative. The vendor link is the price.
// - `sku` is filled only where the vendor part number is certain; otherwise it
//   is null and the vendor search link does the job. A wrong SKU orders the
//   wrong part.
// - `spec` is what you need to know to pick between neighbours (bore, pitch,
//   thread, voltage), not marketing copy.

export type CatalogCategory =
  | "motor"
  | "electronics"
  | "pneumatics"
  | "hardware"
  | "raw_stock"
  | "gearbox"
  | "wheel"
  | "battery"
  | "tool";

export const CATALOG_CATEGORY_LABELS: Record<CatalogCategory, string> = {
  motor: "Motors",
  electronics: "Electronics & control",
  pneumatics: "Pneumatics",
  hardware: "Hardware & fasteners",
  raw_stock: "Raw stock",
  gearbox: "Gears, belts & drive",
  wheel: "Wheels & bearings",
  battery: "Batteries & power",
  tool: "Tools",
};

export type CatalogVendor = "REV" | "WCP" | "AndyMark" | "VEX" | "CTRE" | "McMaster-Carr" | "Thrifty Bot" | "Various";

export type CatalogPart = {
  id: string;
  name: string;
  category: CatalogCategory;
  vendor: CatalogVendor;
  /** Vendor part number, only when certain. */
  sku: string | null;
  /** The thing you need to know to pick this over its neighbours. */
  spec: string;
  /** Where it goes on a robot and why you would want it. */
  use: string;
  /** Inventory unit when added to stock. */
  unit: "each" | "ft" | "pack" | "pair";
  /** Search terms students actually type. */
  aliases: string[];
  /** Typical minimum a team keeps; a suggestion, not a fact about your stock. */
  suggestedMin: number | null;
};

const P = (p: CatalogPart) => p;

export const PARTS_CATALOG: CatalogPart[] = [
  // ------------------------------------------------------------ motors
  P({ id: "rev-neo", name: "NEO Brushless Motor V1.1", category: "motor", vendor: "REV", sku: "REV-21-1650", spec: "12 V brushless, 8 mm shaft with 1/2 in hex adapter compatible, integrated encoder", use: "Drivetrain, shooters, arms — the default FRC motor when paired with a SPARK MAX", unit: "each", aliases: ["neo", "brushless", "drive motor"], suggestedMin: 2 }),
  P({ id: "rev-neo-550", name: "NEO 550", category: "motor", vendor: "REV", sku: "REV-21-1651", spec: "12 V brushless, 550-size can, high RPM low torque", use: "Intakes, indexers, small rollers where weight matters and torque does not", unit: "each", aliases: ["550", "neo550", "small motor"], suggestedMin: 1 }),
  P({ id: "rev-neo-vortex", name: "NEO Vortex", category: "motor", vendor: "REV", sku: "REV-21-1652", spec: "12 V brushless, swappable shaft (MAXSpline), higher power than NEO", use: "Shooters and drivetrains that want more power than a NEO", unit: "each", aliases: ["vortex"], suggestedMin: null }),
  P({ id: "ctre-kraken", name: "Kraken X60", category: "motor", vendor: "CTRE", sku: null, spec: "12 V brushless with integrated Talon FX controller, CAN, 1/2 in hex or spline shaft options", use: "Swerve drive and high-power mechanisms; the controller is built in", unit: "each", aliases: ["kraken", "talon fx", "x60"], suggestedMin: null }),
  P({ id: "ctre-falcon", name: "Falcon 500 (legacy)", category: "motor", vendor: "CTRE", sku: null, spec: "12 V brushless with integrated Talon FX, superseded by Kraken X60", use: "Still on many robots; keep spares if your drive uses them", unit: "each", aliases: ["falcon"], suggestedMin: null }),
  P({ id: "am-775pro", name: "775pro", category: "motor", vendor: "VEX", sku: "217-4347", spec: "12 V brushed, 775 can, needs external controller and must not stall", use: "Legacy mechanisms; burns out if stalled — avoid on arms", unit: "each", aliases: ["775"], suggestedMin: null }),
  P({ id: "am-snowblower", name: "Snow Blower Motor", category: "motor", vendor: "AndyMark", sku: "am-2235a", spec: "12 V brushed, integrated gearbox, ~100 RPM, self-locking-ish", use: "Slow high-torque jobs: hood adjust, latch, small winch", unit: "each", aliases: ["snowblower", "snow blower"], suggestedMin: null }),

  // ------------------------------------------------------------ electronics
  P({ id: "rev-sparkmax", name: "SPARK MAX Motor Controller", category: "electronics", vendor: "REV", sku: "REV-11-2158", spec: "Brushless/brushed, CAN or PWM, 60 A continuous", use: "One per NEO / NEO 550 / Vortex", unit: "each", aliases: ["spark max", "sparkmax", "motor controller"], suggestedMin: 2 }),
  P({ id: "rev-sparkflex", name: "SPARK Flex Motor Controller", category: "electronics", vendor: "REV", sku: "REV-11-2159", spec: "Docks directly onto a NEO Vortex; CAN", use: "Controller for the Vortex", unit: "each", aliases: ["spark flex", "sparkflex"], suggestedMin: null }),
  P({ id: "rev-pdh", name: "Power Distribution Hub", category: "electronics", vendor: "REV", sku: "REV-11-1850", spec: "20 channels, 40 A / 30 A / 20 A / 15 A breakers, CAN monitoring", use: "The robot's power distribution; one per robot", unit: "each", aliases: ["pdh", "power distribution", "pdp"], suggestedMin: null }),
  P({ id: "rev-pcm", name: "Pneumatic Hub", category: "electronics", vendor: "REV", sku: "REV-11-1852", spec: "16 solenoid channels, 12 V or 24 V, compressor control, pressure sensor input", use: "Drives solenoids and the compressor", unit: "each", aliases: ["pneumatic hub", "ph", "pcm"], suggestedMin: null }),
  P({ id: "rev-radio-power", name: "Radio Power Module", category: "electronics", vendor: "REV", sku: "REV-11-1856", spec: "Regulated power for the robot radio with PoE", use: "Keeps the radio from browning out on a hard hit", unit: "each", aliases: ["rpm", "radio power"], suggestedMin: null }),
  P({ id: "ni-roborio2", name: "roboRIO 2.0", category: "electronics", vendor: "AndyMark", sku: "am-4590", spec: "The FRC robot controller; microSD image", use: "One per robot, plus a spare if you can afford it", unit: "each", aliases: ["rio", "roborio", "robot controller"], suggestedMin: null }),
  P({ id: "ctre-canivore", name: "CANivore", category: "electronics", vendor: "CTRE", sku: null, spec: "USB CAN FD bus adapter for a second CAN bus", use: "Second bus for a swerve drive full of CTRE devices", unit: "each", aliases: ["canivore", "can bus"], suggestedMin: null }),
  P({ id: "ctre-cancoder", name: "CANcoder", category: "electronics", vendor: "CTRE", sku: null, spec: "Magnetic absolute encoder over CAN", use: "Swerve steering absolute position", unit: "each", aliases: ["cancoder", "absolute encoder"], suggestedMin: null }),
  P({ id: "rev-through-bore", name: "Through Bore Encoder", category: "electronics", vendor: "REV", sku: "REV-11-1271", spec: "1/2 in hex through bore, absolute (duty cycle) + quadrature", use: "Arm and wrist absolute position on a hex shaft", unit: "each", aliases: ["through bore", "hex encoder", "absolute encoder"], suggestedMin: null }),
  P({ id: "main-breaker", name: "120 A Main Breaker", category: "electronics", vendor: "AndyMark", sku: "am-0282", spec: "120 A, the required main disconnect", use: "Required by the rules; keep a spare", unit: "each", aliases: ["main breaker", "120a"], suggestedMin: 1 }),
  P({ id: "anderson-sb50", name: "Anderson SB50 Connector", category: "electronics", vendor: "AndyMark", sku: null, spec: "50 A, 6 AWG contacts, red housing (battery standard)", use: "Battery and main power connections", unit: "each", aliases: ["anderson", "sb50", "battery connector"], suggestedMin: 4 }),
  P({ id: "wago-221", name: "WAGO 221 Lever Connector (5-way)", category: "electronics", vendor: "Various", sku: null, spec: "12–24 AWG, tool-free, 5 conductors", use: "Sensor and low-current splices; legal and quick", unit: "pack", aliases: ["wago", "lever nut", "splice"], suggestedMin: 1 }),
  P({ id: "wire-12awg", name: "12 AWG Silicone Wire (red/black)", category: "electronics", vendor: "Various", sku: null, spec: "12 AWG, silicone insulation, for 40 A branches", use: "Motor power runs from the PDH", unit: "ft", aliases: ["12 awg", "wire", "motor wire"], suggestedMin: 25 }),
  P({ id: "wire-18awg", name: "18 AWG Wire (red/black)", category: "electronics", vendor: "Various", sku: null, spec: "18 AWG, for ≤ 10 A signal and low-power runs", use: "Sensors, solenoids, small devices", unit: "ft", aliases: ["18 awg", "signal wire"], suggestedMin: 25 }),
  P({ id: "can-wire", name: "CAN Wire (yellow/green twisted)", category: "electronics", vendor: "Various", sku: null, spec: "22 AWG twisted pair, yellow/green", use: "Every CAN device; keep plenty — it is the wire you run out of", unit: "ft", aliases: ["can", "yellow green", "twisted pair"], suggestedMin: 50 }),

  // ------------------------------------------------------------ pneumatics
  P({ id: "compressor", name: "Compressor (12 V, 1.1 CFM class)", category: "pneumatics", vendor: "AndyMark", sku: null, spec: "12 V, ~1.1 CFM, 120 psi max; must be an approved FRC compressor", use: "The robot's only air source", unit: "each", aliases: ["compressor", "viair"], suggestedMin: null }),
  P({ id: "solenoid-double", name: "Double Solenoid Valve (12 V)", category: "pneumatics", vendor: "AndyMark", sku: null, spec: "12 V, 5-port 2-position, 1/8 NPT", use: "One per double-acting cylinder that must hold either state", unit: "each", aliases: ["solenoid", "double solenoid", "valve"], suggestedMin: 1 }),
  P({ id: "cylinder-3-4", name: "Pneumatic Cylinder, 3/4 in bore", category: "pneumatics", vendor: "Various", sku: null, spec: "3/4 in bore, double-acting, stroke to suit; ~26 lbf at 60 psi", use: "Light actuation: hard stops, small deploys", unit: "each", aliases: ["cylinder", "piston", "3/4 bore"], suggestedMin: null }),
  P({ id: "cylinder-1-1-16", name: "Pneumatic Cylinder, 1-1/16 in bore", category: "pneumatics", vendor: "Various", sku: null, spec: "1-1/16 in bore, double-acting; ~53 lbf at 60 psi", use: "The common FRC cylinder for intakes and climbers", unit: "each", aliases: ["cylinder", "piston", "1 1/16"], suggestedMin: null }),
  P({ id: "tubing-1-4", name: "1/4 in OD Pneumatic Tubing", category: "pneumatics", vendor: "Various", sku: null, spec: "1/4 in OD polyurethane, 120 psi rated", use: "Everything downstream of the regulator", unit: "ft", aliases: ["tubing", "air line", "1/4 tube"], suggestedMin: 25 }),
  P({ id: "fitting-1-8-npt", name: "Push-to-connect Fitting, 1/8 NPT to 1/4 tube", category: "pneumatics", vendor: "Various", sku: null, spec: "1/8 NPT male, 1/4 in tube", use: "Solenoids and cylinders", unit: "pack", aliases: ["fitting", "push to connect", "npt"], suggestedMin: 1 }),
  P({ id: "pressure-gauge", name: "Pressure Gauge, 0–160 psi", category: "pneumatics", vendor: "Various", sku: null, spec: "1/8 NPT, 0–160 psi; the rules require stored and working pressure to be readable", use: "One on the stored side, one on the working side", unit: "each", aliases: ["gauge", "pressure gauge"], suggestedMin: 2 }),

  // ------------------------------------------------------------ hardware
  P({ id: "screw-10-32-0-5", name: "10-32 × 1/2 in Socket Head Cap Screw", category: "hardware", vendor: "McMaster-Carr", sku: null, spec: "10-32, 1/2 in, alloy steel, black oxide", use: "The FRC default fastener into tapped 10-32 holes and nyloc nuts", unit: "pack", aliases: ["10-32", "shcs", "screw", "bolt"], suggestedMin: 2 }),
  P({ id: "screw-10-32-0-75", name: "10-32 × 3/4 in Socket Head Cap Screw", category: "hardware", vendor: "McMaster-Carr", sku: null, spec: "10-32, 3/4 in, alloy steel", use: "Through two plates with a nut", unit: "pack", aliases: ["10-32", "3/4 screw"], suggestedMin: 2 }),
  P({ id: "screw-1-4-20-0-75", name: "1/4-20 × 3/4 in Socket Head Cap Screw", category: "hardware", vendor: "McMaster-Carr", sku: null, spec: "1/4-20, 3/4 in, alloy steel", use: "Structural joints, bumper mounts, gearbox to frame", unit: "pack", aliases: ["1/4-20", "quarter twenty"], suggestedMin: 1 }),
  P({ id: "nut-10-32-nyloc", name: "10-32 Nylon-insert Lock Nut", category: "hardware", vendor: "McMaster-Carr", sku: null, spec: "10-32, zinc-plated steel, nyloc", use: "Every 10-32 through-bolt; never a plain nut on a robot", unit: "pack", aliases: ["nyloc", "lock nut", "10-32 nut"], suggestedMin: 2 }),
  P({ id: "nut-1-4-20-nyloc", name: "1/4-20 Nylon-insert Lock Nut", category: "hardware", vendor: "McMaster-Carr", sku: null, spec: "1/4-20, zinc-plated steel, nyloc", use: "Every 1/4-20 through-bolt", unit: "pack", aliases: ["nyloc", "1/4-20 nut"], suggestedMin: 1 }),
  P({ id: "rivet-3-16", name: "3/16 in Aluminium Pop Rivet", category: "hardware", vendor: "McMaster-Carr", sku: null, spec: "3/16 in dia, 1/8–1/4 in grip, aluminium body and mandrel", use: "Gussets and sheet to tube; light and fast", unit: "pack", aliases: ["rivet", "pop rivet", "3/16 rivet"], suggestedMin: 1 }),
  P({ id: "shaft-collar-1-2-hex", name: "1/2 in Hex Shaft Collar", category: "hardware", vendor: "WCP", sku: null, spec: "1/2 in hex bore, set screw", use: "Axial retention on hex shafts", unit: "each", aliases: ["shaft collar", "hex collar"], suggestedMin: 4 }),
  P({ id: "spacer-1-2-hex", name: "1/2 in Hex Spacer Assortment", category: "hardware", vendor: "WCP", sku: null, spec: "1/2 in hex bore, aluminium or nylon, assorted lengths", use: "Setting wheel and sprocket positions on hex shafts", unit: "pack", aliases: ["hex spacer", "spacer"], suggestedMin: 1 }),
  P({ id: "vhb", name: "3M VHB Tape, 1 in", category: "hardware", vendor: "Various", sku: null, spec: "1 in wide double-sided acrylic foam tape", use: "Mounting electronics boards and bellypans", unit: "each", aliases: ["vhb", "double sided tape"], suggestedMin: 1 }),
  P({ id: "zip-ties", name: "Zip Ties, 8 in UV-rated", category: "hardware", vendor: "Various", sku: null, spec: "8 in, 50 lb, UV-stabilised nylon", use: "Wire management; keep a bag in every toolbox", unit: "pack", aliases: ["zip tie", "cable tie"], suggestedMin: 2 }),

  // ------------------------------------------------------------ raw stock
  P({ id: "tube-1x1-1-16", name: "1 × 1 in Aluminium Box Tube, 1/16 in wall", category: "raw_stock", vendor: "Various", sku: null, spec: "6061-T6, 1 × 1 in, 0.0625 in wall, typically 8 ft lengths", use: "The FRC structural default: frames, arms, superstructure", unit: "ft", aliases: ["1x1", "box tube", "tube"], suggestedMin: 24 }),
  P({ id: "tube-2x1-1-16", name: "2 × 1 in Aluminium Box Tube, 1/16 in wall", category: "raw_stock", vendor: "Various", sku: null, spec: "6061-T6, 2 × 1 in, 0.0625 in wall", use: "Drivetrain rails and anything that needs more stiffness than 1 × 1", unit: "ft", aliases: ["2x1", "box tube"], suggestedMin: 16 }),
  P({ id: "plate-1-8", name: "1/8 in Aluminium Plate", category: "raw_stock", vendor: "Various", sku: null, spec: "6061-T6, 0.125 in, sheet or 12 × 24 in", use: "Gearbox plates, brackets, gussets", unit: "each", aliases: ["1/8 plate", "aluminum plate", "sheet"], suggestedMin: 1 }),
  P({ id: "plate-1-4", name: "1/4 in Aluminium Plate", category: "raw_stock", vendor: "Various", sku: null, spec: "6061-T6, 0.25 in", use: "Thick brackets, pivots, anything that carries a bearing under load", unit: "each", aliases: ["1/4 plate"], suggestedMin: null }),
  P({ id: "polycarb-1-8", name: "1/8 in Polycarbonate Sheet", category: "raw_stock", vendor: "Various", sku: null, spec: "0.125 in, clear, machinable; NOT acrylic", use: "Guards, intake plates, anything that must not shatter", unit: "each", aliases: ["polycarb", "lexan", "polycarbonate"], suggestedMin: 1 }),
  P({ id: "hex-shaft-1-2", name: "1/2 in Hex Shaft, 7075", category: "raw_stock", vendor: "WCP", sku: null, spec: "1/2 in hex, 7075-T6 aluminium, 36 in", use: "Rollers, arm pivots, wheel axles — the FRC shaft standard", unit: "each", aliases: ["hex shaft", "1/2 hex", "shaft"], suggestedMin: 2 }),
  P({ id: "hex-shaft-3-8", name: "3/8 in Hex Shaft", category: "raw_stock", vendor: "WCP", sku: null, spec: "3/8 in hex, steel or 7075", use: "Small rollers and gearbox output shafts", unit: "each", aliases: ["3/8 hex"], suggestedMin: null }),
  P({ id: "churro", name: "Churro (1/2 in hex, 10-32 tapped)", category: "raw_stock", vendor: "Various", sku: null, spec: "1/2 in hex extrusion pre-tapped 10-32 both ends, aluminium", use: "Standoffs between plates without a lathe", unit: "each", aliases: ["churro", "standoff"], suggestedMin: 4 }),

  // ------------------------------------------------------------ gears, belts, drive
  P({ id: "maxplanetary", name: "MAXPlanetary Gearbox", category: "gearbox", vendor: "REV", sku: null, spec: "Stackable stages 3:1, 4:1, 5:1, 9:1; NEO / Vortex input; 1/2 in hex output", use: "Arms, wrists, intakes — one gearbox family for most mechanisms", unit: "each", aliases: ["maxplanetary", "planetary", "gearbox"], suggestedMin: null }),
  P({ id: "ultraplanetary", name: "UltraPlanetary Gearbox (550)", category: "gearbox", vendor: "REV", sku: null, spec: "Stackable stages for the NEO 550; 1/2 in hex output kit", use: "Light mechanisms driven by a NEO 550", unit: "each", aliases: ["ultraplanetary"], suggestedMin: null }),
  P({ id: "swerve-x2", name: "Swerve X2 Module", category: "gearbox", vendor: "WCP", sku: null, spec: "Kraken/Falcon drive and steer, CANcoder, multiple ratios; check the vendor for current variant", use: "Swerve drivetrain — four per robot plus a spare", unit: "each", aliases: ["swerve", "swerve module", "x2"], suggestedMin: null }),
  P({ id: "swerve-mk4i", name: "MK4i Swerve Module", category: "gearbox", vendor: "Various", sku: null, spec: "SDS MK4i, inverted steer, L1–L3 ratios; sold by SDS", use: "Swerve drivetrain", unit: "each", aliases: ["mk4i", "sds", "swerve"], suggestedMin: null }),
  P({ id: "belt-htd-5mm", name: "HTD 5 mm Timing Belt", category: "gearbox", vendor: "WCP", sku: null, spec: "5 mm pitch, 9 or 15 mm wide, length by tooth count", use: "Shooter and drive belt runs; order the exact tooth count from the CAD", unit: "each", aliases: ["belt", "htd", "timing belt"], suggestedMin: null }),
  P({ id: "pulley-htd-hex", name: "HTD 5 mm Pulley, 1/2 in hex", category: "gearbox", vendor: "WCP", sku: null, spec: "5 mm pitch, 1/2 in hex bore, tooth count to suit", use: "Pairs with HTD belts on hex shafts", unit: "each", aliases: ["pulley", "hex pulley"], suggestedMin: null }),
  P({ id: "sprocket-25-hex", name: "#25 Sprocket, 1/2 in hex", category: "gearbox", vendor: "WCP", sku: null, spec: "#25 chain, 1/2 in hex bore, tooth count to suit", use: "Chain drives on arms and drivetrains", unit: "each", aliases: ["sprocket", "#25"], suggestedMin: null }),
  P({ id: "chain-25", name: "#25 Roller Chain", category: "gearbox", vendor: "Various", sku: null, spec: "#25 (1/4 in pitch), 10 ft box; master links separately", use: "Chain drives", unit: "each", aliases: ["chain", "#25 chain"], suggestedMin: null }),
  P({ id: "gear-20dp-hex", name: "20 DP Gear, 1/2 in hex", category: "gearbox", vendor: "WCP", sku: null, spec: "20 diametral pitch, 1/2 in hex bore, aluminium or steel", use: "Custom gearboxes; steel for the pinion, aluminium elsewhere", unit: "each", aliases: ["gear", "20dp"], suggestedMin: null }),

  // ------------------------------------------------------------ wheels & bearings
  P({ id: "bearing-1-2-hex-flanged", name: "1/2 in Hex Flanged Bearing (1.125 in OD)", category: "wheel", vendor: "WCP", sku: null, spec: "1/2 in hex bore, 1.125 in OD, flanged; press-fits a 1.125 in hole", use: "Every hex shaft through a plate — the most-used bearing in FRC", unit: "each", aliases: ["hex bearing", "flanged bearing", "1.125 bearing"], suggestedMin: 8 }),
  P({ id: "bearing-1-2-round", name: "1/2 in Round Flanged Bearing (1.125 in OD)", category: "wheel", vendor: "WCP", sku: null, spec: "1/2 in round bore, 1.125 in OD, flanged", use: "Round shafts and dead axles", unit: "each", aliases: ["round bearing"], suggestedMin: 4 }),
  P({ id: "bearing-3-8-hex", name: "3/8 in Hex Flanged Bearing (0.875 in OD)", category: "wheel", vendor: "WCP", sku: null, spec: "3/8 in hex bore, 0.875 in OD, flanged", use: "3/8 in hex shafts", unit: "each", aliases: ["3/8 bearing"], suggestedMin: null }),
  P({ id: "wheel-4in-colson", name: "4 in Colson Wheel, 1/2 in hex", category: "wheel", vendor: "VEX", sku: null, spec: "4 in dia, 1.5 in wide, ~1.0 CoF", use: "Tank-drive traction wheel", unit: "each", aliases: ["colson", "4 inch wheel"], suggestedMin: null }),
  P({ id: "wheel-4in-swerve", name: "4 in Swerve Wheel (tread), 1/2 in hex", category: "wheel", vendor: "WCP", sku: null, spec: "4 in dia, 1.5 in wide, replaceable tread", use: "Swerve modules; keep tread spares for competition", unit: "each", aliases: ["swerve wheel", "tread"], suggestedMin: null }),
  P({ id: "compliant-wheel", name: "4 in Compliant Wheel (35A), 1/2 in hex", category: "wheel", vendor: "AndyMark", sku: null, spec: "4 in dia, 35A durometer, 1/2 in hex", use: "Intake and indexer rollers that need to grip a game piece", unit: "each", aliases: ["compliant wheel", "intake wheel", "35a"], suggestedMin: null }),
  P({ id: "omni-wheel", name: "4 in Omni Wheel, 1/2 in hex", category: "wheel", vendor: "VEX", sku: null, spec: "4 in dia, rollers at 90°", use: "Kitbot-style drivetrains that need to turn", unit: "each", aliases: ["omni"], suggestedMin: null }),

  // ------------------------------------------------------------ batteries & power
  P({ id: "battery-mk-es17", name: "MK ES17-12 Battery", category: "battery", vendor: "AndyMark", sku: null, spec: "12 V 18 Ah SLA, one of the FRC-legal batteries", use: "Robot batteries — a competition wants six or more, rotated and logged", unit: "each", aliases: ["battery", "es17", "mk battery"], suggestedMin: 6 }),
  P({ id: "battery-charger", name: "Multi-bank Battery Charger (6 A/bank)", category: "battery", vendor: "Various", sku: null, spec: "12 V SLA, 6 A per bank, 3+ banks; the rules cap at 6 A", use: "Charging between matches", unit: "each", aliases: ["charger"], suggestedMin: null }),
  P({ id: "battery-lead-6awg", name: "6 AWG Battery Lead with SB50", category: "battery", vendor: "AndyMark", sku: null, spec: "6 AWG, SB50 red connector, ring terminals", use: "Battery to main breaker; keep spares, they get crimped badly", unit: "each", aliases: ["battery lead", "6 awg"], suggestedMin: 2 }),

  // ------------------------------------------------------------ tools
  P({ id: "crimper-anderson", name: "Anderson / Powerpole Crimper", category: "tool", vendor: "Various", sku: null, spec: "Crimps SB50 6 AWG and Powerpole 15/30/45 contacts", use: "Every battery lead and PDH feed", unit: "each", aliases: ["crimper", "anderson crimper"], suggestedMin: null }),
  P({ id: "tap-10-32", name: "10-32 Tap and Drill (#21)", category: "tool", vendor: "McMaster-Carr", sku: null, spec: "10-32 tap, #21 (0.159 in) tap drill; #9 (0.196 in) clearance drill", use: "Tapping the 10-32 holes in every plate and churro", unit: "each", aliases: ["tap", "10-32 tap", "#21 drill"], suggestedMin: 2 }),
  P({ id: "tap-1-4-20", name: "1/4-20 Tap and Drill (#7)", category: "tool", vendor: "McMaster-Carr", sku: null, spec: "1/4-20 tap, #7 (0.201 in) tap drill; 17/64 in clearance drill", use: "Structural 1/4-20 tapped holes", unit: "each", aliases: ["1/4-20 tap", "#7 drill"], suggestedMin: 1 }),
  P({ id: "rivet-gun", name: "Pop Rivet Gun", category: "tool", vendor: "Various", sku: null, spec: "Manual, 3/32–3/16 in nosepieces", use: "Gussets and sheet", unit: "each", aliases: ["rivet gun", "riveter"], suggestedMin: null }),
  P({ id: "hex-keys", name: "Ball-end Hex Key Set (SAE)", category: "tool", vendor: "Various", sku: null, spec: "0.050–3/8 in, ball end; 5/32 in fits 10-32 SHCS, 3/16 in fits 1/4-20", use: "The two sizes you use most are 5/32 and 3/16 — buy extras of those", unit: "each", aliases: ["hex key", "allen key", "allen wrench"], suggestedMin: null }),
];

/** Vendor search URL for a part; the honest price is on the vendor's page. */
export function vendorSearchUrl(part: CatalogPart): string {
  const q = encodeURIComponent(part.sku ?? part.name);
  switch (part.vendor) {
    case "REV":
      return `https://www.revrobotics.com/search/?q=${q}`;
    case "WCP":
      return `https://wcproducts.com/search?q=${q}`;
    case "AndyMark":
      return `https://www.andymark.com/pages/search-results?q=${q}`;
    case "VEX":
      return `https://www.vexrobotics.com/search?q=${q}`;
    case "CTRE":
      return `https://store.ctr-electronics.com/search?q=${q}`;
    case "McMaster-Carr":
      return `https://www.mcmaster.com/${q}`;
    case "Thrifty Bot":
      return `https://www.thethriftybot.com/search?q=${q}`;
    default:
      return `https://www.google.com/search?q=${encodeURIComponent(`${part.name} FRC`)}`;
  }
}

/** Search by name, alias, spec, vendor or SKU. Empty query returns everything. */
export function searchCatalog(query: string, category?: CatalogCategory | null): CatalogPart[] {
  const q = query.trim().toLowerCase();
  const terms = q ? q.split(/\s+/) : [];
  return PARTS_CATALOG.filter((p) => {
    if (category && p.category !== category) return false;
    if (terms.length === 0) return true;
    const hay = [p.name, p.spec, p.use, p.vendor, p.sku ?? "", ...p.aliases].join(" ").toLowerCase();
    return terms.every((t) => hay.includes(t));
  });
}

/** Map a catalog category onto the inventory table's vocabulary (0462). */
export function inventoryCategoryFor(category: CatalogCategory): string {
  // Every catalog category is already a legal inventory category; the
  // catalog vocabulary was chosen as a subset on purpose.
  return category;
}
