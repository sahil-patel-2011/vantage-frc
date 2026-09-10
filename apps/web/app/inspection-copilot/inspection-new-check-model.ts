export type WeightItemDraft = { name: string; weightLbs: string };

export type InspectionCheckKey =
  | "bumperEventRecorded"
  | "solidCoreFoam"
  | "separateColorSets"
  | "bumperGapsOk"
  | "bumperNoElectronics"
  | "bumperNumbersLegal"
  | "bumperHardPartsOk"
  | "bumperHardPartsInset"
  | "bumperBackingTall"
  | "bumperCornersFilled"
  | "bumperCoverOk"
  | "bumperCrossSectionOk"
  | "bumperRemovableOk"
  | "batterySecured"
  | "wiresLabeled"
  | "radioPowerOk"
  | "bypassSwitchAccessible"
  | "radioEventRecorded"
  | "radioOnMainPd"
  | "rioOnMainPd10A"
  | "radioProgrammedForEvent"
  | "radioWeidmullerQc"
  | "radioLedsVisible"
  | "rioEthernetPathOk"
  | "rioRadioDedicatedOk"
  | "sparkMaxEventRecorded"
  | "sparkMaxUsbAvoided"
  | "reliabilityEventRecorded"
  | "strainReliefOk"
  | "dynamicCableClear"
  | "esdIntakeBonded"
  | "esdShielded"
  | "canivorePdhBackup"
  | "batteryLeadsTorqued"
  | "mainBreakerCovered"
  | "rioUsbCameraClear"
  | "pcmRadioSeparated"
  | "pneumaticsEventRecorded"
  | "ventPlugAccessible"
  | "singleOnboardCompressor"
  | "reliefValveOnCompressor"
  | "workingPressure60Psi"
  | "pressureSwitchOnPcmPh"
  | "componentsRated"
  | "compressorStops120"
  | "compressorPowerOk"
  | "tubingOdOk"
  | "relievingRegulatorOk"
  | "compressorStartsEnabled"
  | "pneumaticsUnmodified"
  | "solenoidsLegal"
  | "gaugesVisible"
  | "isolationEventRecorded"
  | "frameIsolated120"
  | "unusedPdPortsTaped"
  | "pdhFusesOk"
  | "atcAtoFusesOk"
  | "pdVisible"
  | "pdBreakersOk"
  | "rslEventRecorded"
  | "rslVisible36"
  | "rslOnRioPort"
  | "binderRecorded"
  | "bomPrinted"
  | "inspectionChecklistPrinted"
  | "studentCaptainPresent";

export type InspectionMeasureKey =
  | "weightLimitLbs"
  | "perimeterLimitIn"
  | "measuredPerimeterIn"
  | "startingHeightLimitIn"
  | "measuredStartingHeightIn"
  | "extensionLimitIn"
  | "measuredExtensionIn"
  | "bumperMinHeightIn"
  | "bumperMaxHeightIn"
  | "measuredBumperMinHeightIn"
  | "measuredBumperMaxHeightIn"
  | "bumperMinThicknessIn"
  | "measuredBumperThicknessIn"
  | "mainBreakerMaxAmps"
  | "installedMainBreakerAmps";

export type InspectionFormState = {
  robotName: string;
  weightItems: WeightItemDraft[];
} & Record<InspectionMeasureKey, string> &
  Record<InspectionCheckKey, boolean>;

export type InspectionCheckItem = { key: InspectionCheckKey; label: string };

export type InspectionCheckSection = {
  id: string;
  title: string;
  hint?: string;
  gate?: InspectionCheckKey;
  items: readonly InspectionCheckItem[];
};

export type InspectionMeasureField = { key: InspectionMeasureKey; label: string };

export const WEIGHT_LIMIT_FIELD_LABEL = "Weight limit (lbs) — default 115 until you set one";

export const emptyWeightRow = (): WeightItemDraft => ({ name: "", weightLbs: "" });

const INITIAL_CHECKS: Record<InspectionCheckKey, boolean> = {
  bumperEventRecorded: false,
  solidCoreFoam: false,
  separateColorSets: false,
  bumperGapsOk: false,
  bumperNoElectronics: false,
  bumperNumbersLegal: false,
  bumperHardPartsOk: false,
  bumperHardPartsInset: false,
  bumperBackingTall: false,
  bumperCornersFilled: false,
  bumperCoverOk: false,
  bumperCrossSectionOk: false,
  bumperRemovableOk: false,
  batterySecured: false,
  wiresLabeled: false,
  radioPowerOk: false,
  bypassSwitchAccessible: false,
  radioEventRecorded: false,
  radioOnMainPd: false,
  rioOnMainPd10A: false,
  radioProgrammedForEvent: false,
  radioWeidmullerQc: false,
  radioLedsVisible: false,
  rioEthernetPathOk: false,
  rioRadioDedicatedOk: false,
  sparkMaxEventRecorded: false,
  sparkMaxUsbAvoided: false,
  reliabilityEventRecorded: false,
  strainReliefOk: false,
  dynamicCableClear: false,
  esdIntakeBonded: false,
  esdShielded: false,
  canivorePdhBackup: false,
  batteryLeadsTorqued: false,
  mainBreakerCovered: false,
  rioUsbCameraClear: false,
  pcmRadioSeparated: false,
  pneumaticsEventRecorded: false,
  ventPlugAccessible: false,
  singleOnboardCompressor: false,
  reliefValveOnCompressor: false,
  workingPressure60Psi: false,
  pressureSwitchOnPcmPh: false,
  componentsRated: false,
  compressorStops120: false,
  compressorPowerOk: false,
  tubingOdOk: false,
  relievingRegulatorOk: false,
  compressorStartsEnabled: false,
  pneumaticsUnmodified: false,
  solenoidsLegal: false,
  gaugesVisible: false,
  isolationEventRecorded: false,
  frameIsolated120: false,
  unusedPdPortsTaped: false,
  pdhFusesOk: false,
  atcAtoFusesOk: false,
  pdVisible: false,
  pdBreakersOk: false,
  rslEventRecorded: false,
  rslVisible36: false,
  rslOnRioPort: false,
  binderRecorded: false,
  bomPrinted: false,
  inspectionChecklistPrinted: false,
  studentCaptainPresent: false,
};

export const INITIAL_INSPECTION_FORM: InspectionFormState = {
  robotName: "",
  weightItems: [emptyWeightRow()],
  weightLimitLbs: "115",
  perimeterLimitIn: "110",
  measuredPerimeterIn: "",
  startingHeightLimitIn: "30",
  measuredStartingHeightIn: "",
  extensionLimitIn: "12",
  measuredExtensionIn: "",
  bumperMinHeightIn: "2.75",
  bumperMaxHeightIn: "5.5",
  measuredBumperMinHeightIn: "",
  measuredBumperMaxHeightIn: "",
  bumperMinThicknessIn: "2",
  measuredBumperThicknessIn: "",
  mainBreakerMaxAmps: "120",
  installedMainBreakerAmps: "120",
  ...INITIAL_CHECKS,
};

export const FRAME_MEASURE_FIELDS: readonly InspectionMeasureField[] = [
  { key: "perimeterLimitIn", label: "Perimeter limit (in)" },
  { key: "measuredPerimeterIn", label: "Measured perimeter (in)" },
  { key: "startingHeightLimitIn", label: "Starting height limit (in)" },
  { key: "measuredStartingHeightIn", label: "Measured starting height (in)" },
  { key: "extensionLimitIn", label: "In-match extension limit (in)" },
  { key: "measuredExtensionIn", label: "Measured max extension (in)" },
  { key: "bumperMinHeightIn", label: "Bumper min height (in)" },
  { key: "bumperMaxHeightIn", label: "Bumper max height (in)" },
  { key: "measuredBumperMinHeightIn", label: "Measured bumper min height (in)" },
  { key: "measuredBumperMaxHeightIn", label: "Measured bumper max height (in)" },
  { key: "bumperMinThicknessIn", label: "Bumper min thickness (in)" },
  { key: "measuredBumperThicknessIn", label: "Measured bumper thickness (in)" },
];

export const WIRING_MEASURE_FIELDS: readonly InspectionMeasureField[] = [
  { key: "mainBreakerMaxAmps", label: "Main breaker max (A)" },
  { key: "installedMainBreakerAmps", label: "Installed main breaker (A)" },
];

export const INSPECTION_CHECK_SECTIONS: readonly InspectionCheckSection[] = [
  {
    id: "bumpers",
    title: "Frame / bumper limits vs measured",
    hint: "Chief Delphi: hollow pool noodles and reversible bumpers fail Thursday. Leave this off until you actually walk the bumpers.",
    gate: "bumperEventRecorded",
    items: [
      { key: "bumperEventRecorded", label: "We logged bumper construction for this robot" },
      { key: "solidCoreFoam", label: "Padding is solid-core foam (not hollow pool noodles)" },
      { key: "separateColorSets", label: "Separate red and blue sets (not reversible)" },
      {
        key: "bumperGapsOk",
        label: "Gaps under 1.25 in, or one larger gap with ≥ 5 in from each corner (R401)",
      },
      { key: "bumperNoElectronics", label: "No moving or electrical parts in the bumpers (R409)" },
      {
        key: "bumperNumbersLegal",
        label: "White Arabic numerals ≥ 3.5 in × 0.25 in stroke on at least 3 sides ~90° apart (R412)",
      },
      {
        key: "bumperHardPartsOk",
        label: "Bumpers do not extend > 4.25 in from the robot perimeter (R403)",
      },
      {
        key: "bumperHardPartsInset",
        label: "Hard parts ≤ 1.5 in from the perimeter; padding ≥ 2 in past hard parts (R404)",
      },
      {
        key: "bumperBackingTall",
        label: "Backing ≥ 4.25 in tall and supports all padding (R402)",
      },
      {
        key: "bumperCornersFilled",
        label: "Corners filled with ≥ 2 in uncompressed padding, measured diagonally (R406)",
      },
      { key: "bumperCoverOk", label: "Cloth cover covers all padding (R402)" },
      {
        key: "bumperCrossSectionOk",
        label: "Every vertical cross-section has padding, backing, and cover (wrap only at ends)",
      },
      { key: "bumperRemovableOk", label: "Securely mounted and easily removable for inspection" },
    ],
  },
  {
    id: "wiring",
    title: "Wiring / power limits vs installed",
    items: [
      { key: "batterySecured", label: "Battery secured" },
      { key: "wiresLabeled", label: "Wires labeled" },
      { key: "radioPowerOk", label: "Radio power path OK (generic)" },
      { key: "bypassSwitchAccessible", label: "Bypass switch accessible" },
    ],
  },
  {
    id: "radio",
    title: "2026 radio / roboRIO power",
    hint: "Chief Delphi: rio and radio must come off the main PD — Mini PD / RPM / VRM stops inspection. TU07: each is the only load on its 10A branch. Leave this off until you actually walk the wiring.",
    gate: "radioEventRecorded",
    items: [
      { key: "radioEventRecorded", label: "We logged radio / RIO power for this event" },
      {
        key: "radioOnMainPd",
        label: "Radio on main PD 12V and/or passive PoE injector (not VRM/RPM/Mini)",
      },
      { key: "rioOnMainPd10A", label: "roboRIO on a non-switched 10A PD branch" },
      { key: "radioProgrammedForEvent", label: "Radio programmed for this event" },
      {
        key: "radioWeidmullerQc",
        label: "Second person QC'd VH-109 Weidmuller power leads (no stray strands / over-strip)",
      },
      {
        key: "radioLedsVisible",
        label: "Radio LEDs visible to field staff (not buried in the bellypan)",
      },
      {
        key: "rioEthernetPathOk",
        label:
          "roboRIO ethernet on v1.5 RIO port, or v1.0 via PoE injector / modified cable / AUX DIP off",
      },
      {
        key: "rioRadioDedicatedOk",
        label: "RIO and radio each the only load on their 10A PD branch (TU07)",
      },
    ],
  },
  {
    id: "spark",
    title: "Spark MAX USB-C",
    hint: "Chief Delphi 2026: a shorted Spark MAX phase can back-feed through USB-C and fry a laptop. Leave this off until you actually log the check.",
    gate: "sparkMaxEventRecorded",
    items: [
      { key: "sparkMaxEventRecorded", label: "We logged Spark MAX USB policy for this robot" },
      {
        key: "sparkMaxUsbAvoided",
        label: "Will not plug USB-C into a Spark MAX that is behaving unexpectedly (use CAN)",
      },
    ],
  },
  {
    id: "reliability",
    title: "2026 pit reliability",
    hint: "FRC pit walk: strain relief, cable pinch, static vs loose wiring, CANivore backup power, torqued leads, breaker cover, no RIO USB camera next to a CANivore, PCM/PH away from the radio. Leave this off until you actually walk the robot.",
    gate: "reliabilityEventRecorded",
    items: [
      { key: "reliabilityEventRecorded", label: "We logged this robot's pit-reliability walk" },
      { key: "strainReliefOk", label: "Every connection has strain relief" },
      {
        key: "dynamicCableClear",
        label: "CAN / signal / power clear of igus pinch and rotating mechanisms",
      },
      {
        key: "esdIntakeBonded",
        label: "Intake chassis-bonded (not to power) — check wiring before blaming static",
      },
      { key: "esdShielded", label: "Gyros / sensitive electronics foil or copper wrapped" },
      { key: "canivorePdhBackup", label: "CANivore has a PDH power backup if USB drops" },
      { key: "batteryLeadsTorqued", label: "Battery / main breaker / PD lead bolts torqued" },
      { key: "mainBreakerCovered", label: "Main breaker has a cover" },
      {
        key: "rioUsbCameraClear",
        label: "No USB camera on the RIO ports next to a CANivore (ESD kills both 5 V rails)",
      },
      {
        key: "pcmRadioSeparated",
        label: "PCM/PH kept away from the radio (RF looks like a compressor fault)",
      },
    ],
  },
  {
    id: "pneumatics",
    title: "Pneumatics (skip if the robot has no air)",
    hint: "Inspection checklist: hidden vent plugs, extra compressors, 60 psi working pressure, a missing pressure switch, paint on tanks, illegal solenoids, and buried gauges fail Thursday. Leave this off until you actually walk stored pressure.",
    gate: "pneumaticsEventRecorded",
    items: [
      { key: "pneumaticsEventRecorded", label: "We logged pneumatics for this robot" },
      {
        key: "ventPlugAccessible",
        label: "Vent plug is easily accessible and vents stored pressure to 0 psi",
      },
      { key: "singleOnboardCompressor", label: "Only one onboard legal compressor" },
      {
        key: "reliefValveOnCompressor",
        label: "125 psi relief valve on the compressor outlet (not only on the tank)",
      },
      { key: "workingPressure60Psi", label: "Working pressure regulated to ≤ 60 psi" },
      {
        key: "pressureSwitchOnPcmPh",
        label: "Pressure switch wired to the PCM/PH (compressor stops at stored-pressure setpoint)",
      },
      {
        key: "componentsRated",
        label: "Working parts rated ≥ 70 psi; stored parts rated ≥ 125 psi (R801/R802)",
      },
      { key: "compressorStops120", label: "Compressor stops at ≤ 120 psi under roboRIO control" },
      {
        key: "compressorPowerOk",
        label: "Compressor powered from a PCM/PH or relay (not a motor controller)",
      },
      { key: "tubingOdOk", label: "Tubing is KOP-equivalent, maximum OD 1/4 in" },
      {
        key: "relievingRegulatorOk",
        label: "Relieving regulator ≤ 60 psi providing all working pressure",
      },
      {
        key: "compressorStartsEnabled",
        label: "Compressor starts when enabled with no stored pressure",
      },
      {
        key: "pneumaticsUnmodified",
        label: "Tanks/cylinders unmodified — no paint or large labels (small labels ok)",
      },
      {
        key: "solenoidsLegal",
        label: "Solenoids ≤ 1/8 in NPT (or 1/4 in QC), PCM/PH or relay, outputs not teed",
      },
      {
        key: "gaugesVisible",
        label: "Stored and working gauges on both sides of the regulator, readily visible",
      },
    ],
  },
  {
    id: "isolation",
    title: "R611 frame isolation / PDH debris",
    hint: "Inspectors probe Anderson-to-frame with the battery out and breaker on. Conductive chips in unused PDH sockets reboot radios. The PD, breakers, and wiring have to stay visible. ATC/ATO blades in the PD are ≤ 10A. Leave this off until you actually meter the chassis.",
    gate: "isolationEventRecorded",
    items: [
      {
        key: "isolationEventRecorded",
        label: "We logged isolation and unused-port tape for this robot",
      },
      {
        key: "frameIsolated120",
        label: "Frame >120Ω from both Anderson posts (battery out, breaker on)",
      },
      {
        key: "unusedPdPortsTaped",
        label: "Unused PDH / RIO / VRM ports taped against conductive debris",
      },
      {
        key: "pdhFusesOk",
        label: "PDH ATM fuses ≤ 15A except one 20A for a PCM/PH (or a 20A breaker)",
      },
      { key: "atcAtoFusesOk", label: "PD ATC/ATO blade fuses ≤ 10A (R620-B)" },
      { key: "pdVisible", label: "Single PD, breakers, and associated wiring easily visible" },
      {
        key: "pdBreakersOk",
        label: "ATO/Maxi breakers are VB3-A, AT2-A, MX5-A/L, REV or CTR ATO, all ≤ 40A",
      },
    ],
  },
  {
    id: "rsl",
    title: "Robot signal light (RSL)",
    hint: "2026 checklist: visible from 36 in on at least one side, plugged into the roboRIO RSL port, flashing in sync. Leave this off until you actually walk the light.",
    gate: "rslEventRecorded",
    items: [
      { key: "rslEventRecorded", label: "We logged the robot signal light for this robot" },
      { key: "rslVisible36", label: "Visible from 36 in on at least one side" },
      { key: "rslOnRioPort", label: "Plugged into the roboRIO RSL port and flashing in sync" },
    ],
  },
  {
    id: "binder",
    title: "Thursday inspection binder",
    hint: "CD inspectors fail teams that forget a printed BOM. Leave this off until you actually pack the binder.",
    gate: "binderRecorded",
    items: [
      { key: "binderRecorded", label: "We logged binder status" },
      { key: "bomPrinted", label: "Printed BOM packed (part, qty, price, supplier)" },
      { key: "inspectionChecklistPrinted", label: "Printed inspection checklist packed" },
      { key: "studentCaptainPresent", label: "Student team captain present to sign" },
    ],
  },
];

export function canSubmitInspectionCheck(form: InspectionFormState): boolean {
  return (
    form.robotName.trim().length > 0 &&
    form.weightItems.some((row) => row.name.trim() && row.weightLbs !== "")
  );
}

function num(value: string): number {
  return Number(value) || 0;
}

export function buildLogCheckPayload(form: InspectionFormState): Record<string, unknown> {
  return {
    action: "log-check",
    robotName: form.robotName,
    weightBudget: {
      limitLbs: num(form.weightLimitLbs),
      items: form.weightItems
        .filter((row) => row.name.trim() && row.weightLbs !== "")
        .map((row) => ({ name: row.name, weightLbs: num(row.weightLbs) })),
    },
    frameBumper: {
      perimeterLimitIn: num(form.perimeterLimitIn),
      measuredPerimeterIn: num(form.measuredPerimeterIn),
      bumperMinHeightIn: num(form.bumperMinHeightIn),
      bumperMaxHeightIn: num(form.bumperMaxHeightIn),
      measuredBumperMinHeightIn: num(form.measuredBumperMinHeightIn),
      measuredBumperMaxHeightIn: num(form.measuredBumperMaxHeightIn),
      bumperMinThicknessIn: num(form.bumperMinThicknessIn),
      measuredBumperThicknessIn: num(form.measuredBumperThicknessIn),
      startingHeightLimitIn: num(form.startingHeightLimitIn),
      measuredStartingHeightIn: num(form.measuredStartingHeightIn),
      extensionLimitIn: num(form.extensionLimitIn),
      measuredExtensionIn: num(form.measuredExtensionIn),
      bumperEventRecorded: form.bumperEventRecorded,
      solidCoreFoam: form.solidCoreFoam,
      separateColorSets: form.separateColorSets,
      bumperGapsOk: form.bumperGapsOk,
      bumperNoElectronics: form.bumperNoElectronics,
      bumperNumbersLegal: form.bumperNumbersLegal,
      bumperHardPartsOk: form.bumperHardPartsOk,
      bumperCornersFilled: form.bumperCornersFilled,
      bumperHardPartsInset: form.bumperHardPartsInset,
      bumperBackingTall: form.bumperBackingTall,
      bumperCoverOk: form.bumperCoverOk,
      bumperCrossSectionOk: form.bumperCrossSectionOk,
      bumperRemovableOk: form.bumperRemovableOk,
    },
    wiringPower: {
      mainBreakerMaxAmps: num(form.mainBreakerMaxAmps),
      installedMainBreakerAmps: num(form.installedMainBreakerAmps),
      batterySecured: form.batterySecured,
      wiresLabeled: form.wiresLabeled,
      radioPowerOk: form.radioPowerOk,
      bypassSwitchAccessible: form.bypassSwitchAccessible,
      binderRecorded: form.binderRecorded,
      bomPrinted: form.bomPrinted,
      inspectionChecklistPrinted: form.inspectionChecklistPrinted,
      studentCaptainPresent: form.studentCaptainPresent,
      radioEventRecorded: form.radioEventRecorded,
      radioOnMainPd: form.radioOnMainPd,
      rioOnMainPd10A: form.rioOnMainPd10A,
      radioProgrammedForEvent: form.radioProgrammedForEvent,
      radioWeidmullerQc: form.radioWeidmullerQc,
      radioLedsVisible: form.radioLedsVisible,
      rioEthernetPathOk: form.rioEthernetPathOk,
      rioRadioDedicatedOk: form.rioRadioDedicatedOk,
      sparkMaxEventRecorded: form.sparkMaxEventRecorded,
      sparkMaxUsbAvoided: form.sparkMaxUsbAvoided,
      reliabilityEventRecorded: form.reliabilityEventRecorded,
      strainReliefOk: form.strainReliefOk,
      dynamicCableClear: form.dynamicCableClear,
      esdIntakeBonded: form.esdIntakeBonded,
      esdShielded: form.esdShielded,
      canivorePdhBackup: form.canivorePdhBackup,
      batteryLeadsTorqued: form.batteryLeadsTorqued,
      mainBreakerCovered: form.mainBreakerCovered,
      rioUsbCameraClear: form.rioUsbCameraClear,
      pcmRadioSeparated: form.pcmRadioSeparated,
      pneumaticsEventRecorded: form.pneumaticsEventRecorded,
      ventPlugAccessible: form.ventPlugAccessible,
      singleOnboardCompressor: form.singleOnboardCompressor,
      reliefValveOnCompressor: form.reliefValveOnCompressor,
      workingPressure60Psi: form.workingPressure60Psi,
      pressureSwitchOnPcmPh: form.pressureSwitchOnPcmPh,
      componentsRated: form.componentsRated,
      compressorStops120: form.compressorStops120,
      compressorPowerOk: form.compressorPowerOk,
      tubingOdOk: form.tubingOdOk,
      relievingRegulatorOk: form.relievingRegulatorOk,
      compressorStartsEnabled: form.compressorStartsEnabled,
      pneumaticsUnmodified: form.pneumaticsUnmodified,
      solenoidsLegal: form.solenoidsLegal,
      gaugesVisible: form.gaugesVisible,
      isolationEventRecorded: form.isolationEventRecorded,
      frameIsolated120: form.frameIsolated120,
      unusedPdPortsTaped: form.unusedPdPortsTaped,
      pdhFusesOk: form.pdhFusesOk,
      pdVisible: form.pdVisible,
      pdBreakersOk: form.pdBreakersOk,
      atcAtoFusesOk: form.atcAtoFusesOk,
      rslEventRecorded: form.rslEventRecorded,
      rslVisible36: form.rslVisible36,
      rslOnRioPort: form.rslOnRioPort,
    },
  };
}

export function setWeightField(
  items: WeightItemDraft[],
  index: number,
  key: keyof WeightItemDraft,
  value: string,
): WeightItemDraft[] {
  return items.map((row, i) => (i === index ? { ...row, [key]: value } : row));
}

export function catalogCheckKeys(): InspectionCheckKey[] {
  return INSPECTION_CHECK_SECTIONS.flatMap((section) => section.items.map((item) => item.key));
}
