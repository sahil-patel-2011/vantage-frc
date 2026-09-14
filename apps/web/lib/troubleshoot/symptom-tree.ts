/**
 * Get-unstuck: a curated decision tree for the recurring FRC control-system failures.
 *
 * WHY THIS IS DATA AND NOT A PROMPT
 * ---------------------------------
 * Community research (docs/archive/COMMUNITY_DEMAND_RND.md) rates "get-unstuck help for
 * control-system plumbing — imaging roboRIOs, deploying code, driver station comms"
 * as a constant blocker, and records the community's #1 objection to LLM help:
 * staleness ("recommends deprecated classes", "wrong about 80% of the time").
 *
 * So the knowledge lives here, hand-authored from WPILib and vendor documentation,
 * with a doc URL cited on every fix. The tree must walk a student to an answer with
 * NO model in the loop. The optional AI layer only picks an entry node and phrases
 * the next check — it can never introduce a fix that is not in this file.
 *
 * Pure module: no DB, no network, no `Date.now()`. Colocated tests cover the
 * invariants (reachability, monotonic cost, cited docs).
 */

export type TroubleshootDoc = {
  /** Human label for the citation, e.g. "WPILib · Imaging your roboRIO". */
  label: string;
  url: string;
};

/** Where a check result sends the student next. */
export type TroubleshootNext =
  | { kind: "check"; checkId: string }
  | { kind: "fix"; fixId: string }
  | { kind: "symptom"; symptomId: string };

export type TroubleshootOutcome = {
  id: string;
  /** What the student observed. One tap in the UI. */
  label: string;
  /**
   * What this observation ELIMINATES. This is the teaching payload — the student
   * should finish the walk knowing why the tree went where it went.
   */
  rulesOut: string;
  next: TroubleshootNext;
};

export type TroubleshootCheck = {
  id: string;
  /** The single thing the student does. Exactly one action per step. */
  action: string;
  /** Why this check is worth doing at this point in the walk. */
  why: string;
  /** Rough cost in minutes. Cheap checks come first; see the monotonic-cost test. */
  minutes: number;
  outcomes: TroubleshootOutcome[];
  doc?: TroubleshootDoc;
};

export type TroubleshootFix = {
  id: string;
  title: string;
  steps: string[];
  /** The underlying idea, so the student can generalise instead of memorising. */
  principle: string;
  /** Required. A fix Vantage cannot cite is a fix Vantage does not ship. */
  doc: TroubleshootDoc;
  /** Extra reading, optional. */
  moreDocs?: TroubleshootDoc[];
};

export type TroubleshootSymptom = {
  id: string;
  label: string;
  /** One line a panicking student recognises as their situation. */
  summary: string;
  /** Phrases students actually type. Used by the no-AI matcher. */
  synonyms: string[];
  /**
   * Words used to look for the team's OWN logged history of this failure
   * (FMEA rows, incidents, repair triage). Matched with ILIKE, never fabricated.
   */
  groundingTerms: string[];
  entryCheckId: string;
  checks: TroubleshootCheck[];
  fixes: TroubleshootFix[];
};

/** Doc hosts this tree is allowed to cite. Enforced by test. */
export const ALLOWED_DOC_HOSTS = [
  "docs.wpilib.org",
  "docs.revrobotics.com",
  "docs.ctr-electronics.com",
  "v6.docs.ctr-electronics.com",
] as const;

/**
 * WPILib "stable" tracks the current season, so these links do not rot every
 * January the way a versioned link would. Vendor links are checked each preseason.
 */
export const DOC_FRESHNESS_NOTE =
  "Links point at the vendors' current-season documentation (WPILib `stable`). If a link is wrong, mark the step 'still stuck' so a mentor can re-curate it.";

const W = (label: string, path: string): TroubleshootDoc => ({
  label: `WPILib · ${label}`,
  url: `https://docs.wpilib.org/en/stable/${path}`,
});

const DOCS = {
  gameTools: W("Installing the FRC Game Tools", "docs/zero-to-robot/step-2/frc-game-tools.html"),
  imaging: W("Imaging your roboRIO", "docs/zero-to-robot/step-3/imaging-your-roborio.html"),
  imagingRio2: W("Imaging your roboRIO 2", "docs/zero-to-robot/step-3/roborio2-imaging.html"),
  radio: W("Programming your radio", "docs/zero-to-robot/step-3/radio-programming.html"),
  deploy: W("Building and deploying robot code", "docs/software/vscode-overview/deploying-robot-code.html"),
  thirdParty: W("3rd party libraries", "docs/software/vscode-overview/3rd-party-libraries.html"),
  driverStation: W("Driver Station", "docs/software/driverstation/driver-station.html"),
  dsErrors: W("Driver Station errors and warnings", "docs/software/driverstation/driver-station-errors-warnings.html"),
  dsLog: W("Driver Station log file viewer", "docs/software/driverstation/driver-station-log-viewer.html"),
  netTroubleshoot: W(
    "roboRIO network troubleshooting",
    "docs/networking/networking-introduction/roborio-network-troubleshooting.html",
  ),
  ipConfig: W("IP configurations", "docs/networking/networking-introduction/ip-configurations.html"),
  statusLights: W("Status light quick reference", "docs/hardware/hardware-basics/status-lights-ref.html"),
  canWiring: W("CAN wiring basics", "docs/hardware/hardware-basics/can-wiring-basics.html"),
  brownouts: W("roboRIO brownouts and understanding current draw", "docs/software/roborio-info/roborio-brownouts.html"),
  wiringBest: W("Wiring best practices", "docs/hardware/hardware-basics/wiring-best-practices.html"),
  robotProgram: W("Creating a robot program", "docs/software/vscode-overview/creating-robot-program.html"),
  knownIssues: W("Known issues", "docs/yearly-overview/known-issues.html"),
  rev: { label: "REV Robotics · Hardware Client and brushless docs", url: "https://docs.revrobotics.com/" },
  ctre: { label: "CTR Electronics · Phoenix and Tuner X docs", url: "https://v6.docs.ctr-electronics.com/" },
} satisfies Record<string, TroubleshootDoc>;

export const SYMPTOMS: TroubleshootSymptom[] = [
  // ---------------------------------------------------------------- roboRIO imaging
  {
    id: "roborio-imaging",
    label: "roboRIO will not image",
    summary: "The roboRIO Imaging Tool will not see the rio, or imaging fails part-way.",
    synonyms: [
      "roborio wont image",
      "cannot image roborio",
      "reimage roborio",
      "imaging tool does not see the rio",
      "roborio imaging failed",
      "rio not detected by imaging tool",
      "flash roborio",
    ],
    groundingTerms: ["roborio", "image", "imaging", "rio"],
    entryCheckId: "model",
    checks: [
      {
        id: "model",
        action: "Look at the roboRIO itself. Is it a roboRIO 1 (no card slot) or a roboRIO 2 (microSD card slot on the end)?",
        why: "These are two completely different procedures. A roboRIO 2 is imaged by writing a microSD card, not over USB — running the roboRIO 1 flow against a rio 2 looks exactly like 'imaging is broken'. Rule this out before spending time on cables.",
        minutes: 1,
        doc: DOCS.imaging,
        outcomes: [
          {
            id: "rio1",
            label: "roboRIO 1 — no microSD slot",
            rulesOut: "USB imaging is the right procedure, so a failure here is a tooling, cable, or boot-state problem.",
            next: { kind: "check", checkId: "tools-installed" },
          },
          {
            id: "rio2",
            label: "roboRIO 2 — has a microSD slot",
            rulesOut: "Nothing about the USB imaging path applies. The image lives on the card.",
            next: { kind: "fix", fixId: "rio2-sdcard" },
          },
        ],
      },
      {
        id: "tools-installed",
        action:
          "On the imaging laptop, confirm this season's NI FRC Game Tools are installed, then launch the roboRIO Imaging Tool by right-clicking it and choosing Run as administrator.",
        why: "Free and instant. Last season's Game Tools cannot write this season's image, and without administrator rights the tool silently fails to enumerate the USB device.",
        minutes: 2,
        doc: DOCS.gameTools,
        outcomes: [
          {
            id: "no",
            label: "Not installed for this season, or not run as administrator",
            rulesOut: "Nothing about the rio or the cable is implicated yet — the laptop is not ready.",
            next: { kind: "fix", fixId: "install-game-tools" },
          },
          {
            id: "yes",
            label: "Current Game Tools, launched as administrator",
            rulesOut: "Software install and permissions are eliminated. Next suspect is the physical link or the rio's boot state.",
            next: { kind: "check", checkId: "rio-listed" },
          },
        ],
      },
      {
        id: "rio-listed",
        action:
          "Power the roboRIO from a charged 12 V battery (not USB alone), connect a USB-B cable from the laptop directly to the rio, wait for the Power LED to go solid green, and press Refresh in the Imaging Tool.",
        why: "This is the first test that actually exercises the whole path. Powering from USB alone is a classic false failure: the rio browns out mid-boot and never enumerates.",
        minutes: 4,
        doc: DOCS.imaging,
        outcomes: [
          {
            id: "listed",
            label: "The roboRIO appears in the list",
            rulesOut: "Cable, port, drivers and boot are all fine. Any remaining failure is about which image is being written.",
            next: { kind: "check", checkId: "image-version" },
          },
          {
            id: "not-listed",
            label: "Nothing appears, even after Refresh",
            rulesOut: "The image itself is not the problem — the laptop cannot talk to the rio at all.",
            next: { kind: "check", checkId: "cable-port" },
          },
        ],
      },
      {
        id: "image-version",
        action: "Compare the image version the tool offers against the roboRIO image this season's docs require, then run the format/image.",
        why: "A rio that enumerates but refuses to come up on the Driver Station is almost always sitting on a prior-season image.",
        minutes: 5,
        doc: DOCS.imaging,
        outcomes: [
          {
            id: "match",
            label: "The offered image matches this season",
            rulesOut: "Version mismatch is eliminated; this is now a normal imaging run.",
            next: { kind: "fix", fixId: "run-image" },
          },
          {
            id: "stale",
            label: "The tool only offers an older image",
            rulesOut: "The rio is reachable — the laptop simply does not have this season's image file.",
            next: { kind: "fix", fixId: "install-game-tools" },
          },
        ],
      },
      {
        id: "cable-port",
        action:
          "Swap in a USB cable you know carries data (many are charge-only), move to a USB port directly on the laptop — no hub, no USB-C dongle — and try again.",
        why: "Cables and dongles are the single cheapest thing left to eliminate, and charge-only USB-B cables are common in a shop drawer.",
        minutes: 6,
        doc: DOCS.netTroubleshoot,
        outcomes: [
          {
            id: "works",
            label: "It appears now",
            rulesOut: "The rio and its image were never at fault.",
            next: { kind: "fix", fixId: "bad-cable" },
          },
          {
            id: "still-nothing",
            label: "Still nothing on a known-good cable and direct port",
            rulesOut: "Cabling and host ports are eliminated. The rio is probably not completing boot.",
            next: { kind: "check", checkId: "safe-mode" },
          },
        ],
      },
      {
        id: "safe-mode",
        action:
          "With the rio powered, press and hold the Reset button for about five seconds until the Status LED starts blinking, release it, let the rio finish booting into Safe Mode, then Refresh the Imaging Tool.",
        why: "Safe Mode bypasses a corrupted user image, which is exactly the state a half-finished image leaves the rio in.",
        minutes: 8,
        doc: DOCS.imaging,
        outcomes: [
          {
            id: "safe-works",
            label: "It appears in Safe Mode",
            rulesOut: "The hardware is alive; the previous image was corrupt.",
            next: { kind: "fix", fixId: "safe-mode-image" },
          },
          {
            id: "safe-fails",
            label: "Still nothing, even in Safe Mode",
            rulesOut: "Software, cables, ports and boot state are all eliminated. This is now a hardware or power question.",
            next: { kind: "fix", fixId: "escalate-imaging" },
          },
        ],
      },
    ],
    fixes: [
      {
        id: "rio2-sdcard",
        title: "Image the roboRIO 2 by writing its microSD card",
        steps: [
          "Pull the microSD card out of the roboRIO 2 and put it in a card reader on the laptop.",
          "Open the roboRIO Imaging Tool and switch it to the SD card / roboRIO 2 flow, or use the balenaEtcher path the docs describe.",
          "Write this season's roboRIO 2 image to the card, then put the card back in the rio.",
          "Power-cycle the rio from a charged battery and confirm the Status LED goes out and the Power LED is solid green.",
        ],
        principle:
          "The roboRIO 2 keeps its operating system on removable media, so 'imaging' means writing a card — no USB enumeration is involved at all.",
        doc: DOCS.imagingRio2,
        moreDocs: [DOCS.imaging],
      },
      {
        id: "install-game-tools",
        title: "Install this season's NI FRC Game Tools, then re-run the Imaging Tool as administrator",
        steps: [
          "Uninstall or update to this season's FRC Game Tools bundle (Driver Station, Imaging Tool, and the utilities ship together).",
          "Reboot the laptop — the NI USB drivers are not fully live until you do.",
          "Right-click the roboRIO Imaging Tool and choose Run as administrator.",
          "Refresh, select this season's image, and image the rio.",
        ],
        principle:
          "The Imaging Tool can only write images that shipped with the Game Tools bundle installed on that laptop. The tool is not downloading anything.",
        doc: DOCS.gameTools,
      },
      {
        id: "bad-cable",
        title: "Replace the USB cable and label the bad one",
        steps: [
          "Finish the imaging run on the working cable.",
          "Mark the failed cable and take it out of the electronics kit — do not put it back in the drawer.",
          "Keep one known-good USB-B data cable taped inside the pit cart with the rio spares.",
        ],
        principle:
          "Charge-only and worn USB cables produce a silent, total failure that looks identical to a dead controller. Eliminating the cable early is nearly free.",
        doc: DOCS.netTroubleshoot,
      },
      {
        id: "safe-mode-image",
        title: "Image the roboRIO from Safe Mode",
        steps: [
          "Leave the rio in Safe Mode (Status LED blinking after the five-second Reset hold).",
          "In the Imaging Tool, choose Format Target and select this season's image.",
          "Set the team number in the same dialog before you write.",
          "Let the write complete without unplugging anything, then power-cycle and confirm a normal boot.",
        ],
        principle:
          "Safe Mode boots a minimal known-good system, so a rio that only responds there is telling you the previous image, not the hardware, was damaged.",
        doc: DOCS.imaging,
      },
      {
        id: "run-image",
        title: "Format and image the roboRIO with this season's image",
        steps: [
          "Select the roboRIO in the tool and choose Format Target.",
          "Pick this season's image and enter your team number.",
          "Write, and do not disconnect USB or power until the tool reports success.",
          "Power-cycle, then confirm the Driver Station shows Communications green before you deploy code.",
        ],
        principle:
          "Imaging both installs the operating system and stamps the team number the rio uses to build its own IP address — which is why a wrong team number here breaks networking later.",
        doc: DOCS.imaging,
        moreDocs: [DOCS.ipConfig],
      },
      {
        id: "escalate-imaging",
        title: "Treat it as power or hardware, and swap in a spare rio",
        steps: [
          "Measure the voltage at the rio's power connector while it boots — a sagging supply will fail imaging every time.",
          "Try the same cable and laptop against a different roboRIO. If that images, the first rio is the suspect.",
          "Log the failure in Robot › Failure log with the rio's serial so the team has a record of this unit.",
          "Post the exact tool message and the Status LED pattern to Chief Delphi or the vendor forum — the LED pattern is the diagnostic everyone will ask for first.",
        ],
        principle:
          "When every cheap cause is eliminated, the honest next step is substitution: swap one variable (the rio) and see if the symptom moves with it.",
        doc: DOCS.statusLights,
        moreDocs: [DOCS.knownIssues],
      },
    ],
  },

  // ------------------------------------------------------------------- deploy fails
  {
    id: "deploy-fails",
    label: "Code will not deploy",
    summary: "Build or deploy fails from VS Code / Gradle, so new code never reaches the robot.",
    synonyms: [
      "code wont deploy",
      "cannot deploy",
      "deploy failed",
      "gradle deploy error",
      "build failed",
      "cannot find roborio",
      "deploy hangs",
      "wont deploy",
    ],
    groundingTerms: ["deploy", "gradle", "build", "code"],
    entryCheckId: "build-only",
    checks: [
      {
        id: "build-only",
        action: "With the robot disconnected, run Build Robot Code (WPILib: Build Robot Code) and read the result.",
        why: "Separates a compile problem from a connection problem in one step, without touching the robot. Most 'deploy is broken' reports are a build error scrolled off screen.",
        minutes: 2,
        doc: DOCS.deploy,
        outcomes: [
          {
            id: "build-fails",
            label: "The build itself fails",
            rulesOut: "Networking, the rio, and the Driver Station are all eliminated — the code never got as far as needing them.",
            next: { kind: "fix", fixId: "fix-compile" },
          },
          {
            id: "build-ok",
            label: "Build succeeds",
            rulesOut: "Your code compiles and the toolchain is installed. The failure is in reaching the robot.",
            next: { kind: "check", checkId: "ds-comms" },
          },
        ],
      },
      {
        id: "ds-comms",
        action: "Open the Driver Station and look at the Communications indicator.",
        why: "Deploy uses the same network path the Driver Station does. If the DS cannot reach the rio, no deploy will either — and the DS tells you in one glance.",
        minutes: 3,
        doc: DOCS.driverStation,
        outcomes: [
          {
            id: "red",
            label: "Communications is red",
            rulesOut: "This is not a Gradle problem at all. Fix the link first.",
            next: { kind: "symptom", symptomId: "ds-no-comms" },
          },
          {
            id: "green",
            label: "Communications is green",
            rulesOut: "The network path to the rio works, so the deploy failure is about addressing, credentials, or the project itself.",
            next: { kind: "check", checkId: "team-number" },
          },
        ],
      },
      {
        id: "team-number",
        action:
          "Compare the team number in the Driver Station with the one in your project's .wpilib/wpilib_preferences.json, and with the number the rio was imaged with.",
        why: "Gradle finds the rio by building an address from the team number. One typo sends the deploy at a machine that does not exist, and the error message ('could not find any available roboRIO') never mentions the typo.",
        minutes: 4,
        doc: DOCS.deploy,
        outcomes: [
          {
            id: "mismatch",
            label: "They do not all match",
            rulesOut: "Nothing is wrong with the robot; the tooling is aimed at the wrong address.",
            next: { kind: "fix", fixId: "team-number" },
          },
          {
            id: "match",
            label: "All three match",
            rulesOut: "Addressing is eliminated. Read the actual Gradle failure next.",
            next: { kind: "check", checkId: "deploy-error" },
          },
        ],
      },
      {
        id: "deploy-error",
        action: "Scroll the Gradle output to the FIRST error line (not the last) and match it below.",
        why: "Gradle prints a long tail after the real failure. The first error is the one that tells you what happened; everything after it is fallout.",
        minutes: 5,
        doc: DOCS.deploy,
        outcomes: [
          {
            id: "no-rio",
            label: "“Could not find any available roboRIO” / all addresses failed",
            rulesOut: "The build artifact is fine; the deploy target could not be resolved on any address.",
            next: { kind: "fix", fixId: "no-rio-found" },
          },
          {
            id: "auth",
            label: "Permission denied, authentication failed, or SSH errors",
            rulesOut: "The rio answered — so the network is fine. This is a credentials or image problem.",
            next: { kind: "fix", fixId: "deploy-auth" },
          },
          {
            id: "space",
            label: "No space left on device / write failures on the rio",
            rulesOut: "Connection and credentials are both fine; the rio's storage is full.",
            next: { kind: "fix", fixId: "disk-full" },
          },
          {
            id: "vendordep",
            label: "Missing or mismatched vendor library (vendordeps, Phoenix, REVLib, …)",
            rulesOut: "This would have failed offline too — the robot is not involved.",
            next: { kind: "fix", fixId: "vendordeps" },
          },
          {
            id: "other",
            label: "Something else",
            rulesOut: "Nothing is ruled out yet — capture the evidence before guessing further.",
            next: { kind: "fix", fixId: "capture-log" },
          },
        ],
      },
    ],
    fixes: [
      {
        id: "fix-compile",
        title: "Fix the compile error before touching the robot",
        steps: [
          "Scroll to the first error line in the Gradle output and open the file and line it names.",
          "If the error mentions a class you did not write, check that the vendor library that owns it is in vendordeps and that the version matches this season.",
          "Rebuild until Build Robot Code succeeds with the robot disconnected.",
          "Only then attempt a deploy.",
        ],
        principle:
          "Deploy is build-then-copy. If the build stage fails there is nothing to copy, so no amount of network debugging can help.",
        doc: DOCS.deploy,
        moreDocs: [DOCS.thirdParty],
      },
      {
        id: "team-number",
        title: "Make the team number identical everywhere",
        steps: [
          "Set the team number in the Driver Station Setup tab.",
          "Set it in the project with the WPILib: Set Team Number command (it writes .wpilib/wpilib_preferences.json).",
          "Confirm the rio was imaged with the same number — re-run the Imaging Tool if you are not sure.",
          "Restart VS Code and the Driver Station, then deploy.",
        ],
        principle:
          "The team number is not a label. Both the rio's address (10.TE.AM.2) and the mDNS name roboRIO-TEAM-FRC.local are derived from it, so a mismatch breaks addressing in three places at once.",
        doc: DOCS.ipConfig,
        moreDocs: [DOCS.deploy],
      },
      {
        id: "no-rio-found",
        title: "Give Gradle a path it can actually resolve",
        steps: [
          "Confirm the Driver Station shows Communications green at the same moment you deploy — not five minutes earlier.",
          "Try a wired path (USB-B straight to the rio, or Ethernet) instead of the radio while you debug.",
          "Disable any second network adapter and any VPN; Gradle tries several addresses and a VPN route can swallow all of them.",
          "If mDNS is the problem, deploy over the static address 10.TE.AM.2 to confirm, then fix mDNS separately.",
        ],
        principle:
          "Gradle walks a list of candidate addresses (USB, mDNS, static, DHCP) and only reports failure after all of them time out — so the fix is always to make one specific path work, not to retry.",
        doc: DOCS.netTroubleshoot,
        moreDocs: [DOCS.ipConfig],
      },
      {
        id: "deploy-auth",
        title: "Re-image the rio so the deploy account and image match the tooling",
        steps: [
          "Check that the rio is on this season's image — a prior-season image is the usual cause of an authentication failure from a current-season deploy.",
          "Re-image the roboRIO with this season's image and your team number.",
          "Deploy again from a clean build (Gradle: clean, then Build Robot Code).",
          "If it still refuses, note the exact SSH message before asking for help — it names which account was rejected.",
        ],
        principle:
          "Deploy logs into the rio over SSH as a known account created by the image. Season-to-season changes to that account are why 'it worked last year' is not evidence.",
        doc: DOCS.imaging,
        moreDocs: [DOCS.deploy],
      },
      {
        id: "disk-full",
        title: "Free space on the roboRIO",
        steps: [
          "Connect to the rio's web dashboard or SSH in and look at free space.",
          "Delete accumulated log files and any old deployed artifacts you do not need.",
          "If the rio has been in service for several seasons of logging, re-image it — that is the fastest reliable clean-out.",
          "Add a habit: pull match logs off the rio at the end of each event.",
        ],
        principle:
          "The rio's storage is small and on-robot logging fills it quietly. A full disk fails at the copy stage, after a successful build and a healthy connection — which is why it is the third thing to check, not the first.",
        doc: DOCS.deploy,
      },
      {
        id: "vendordeps",
        title: "Repair the vendor libraries",
        steps: [
          "Open WPILib: Manage Vendor Libraries and check every installed library against this season's vendor JSON URLs.",
          "Remove and re-add any library whose version does not match this season.",
          "Run a Gradle clean, then Build Robot Code offline to confirm the build no longer needs the robot.",
          "Commit the vendordeps folder so the next person gets the same versions.",
        ],
        principle:
          "Vendor libraries are pinned per season by JSON files in your repo. When those drift from the firmware on the devices, you get build errors and — worse — silent runtime mismatches.",
        doc: DOCS.thirdParty,
      },
      {
        id: "capture-log",
        title: "Capture the evidence, then ask with it",
        steps: [
          "Copy the first error line and the ten lines around it from the Gradle output.",
          "Note the Driver Station state at that moment: Communications, Robot Code, and the connection type you used.",
          "Save that as a 'still stuck' note here so the next student sees it, and check this season's WPILib Known Issues page.",
          "Ask in team chat or on Chief Delphi with those two artifacts attached.",
        ],
        principle:
          "A question with the first error line and the Driver Station state gets answered in minutes; 'deploy doesn't work' does not. Capturing evidence IS the next troubleshooting step.",
        doc: DOCS.knownIssues,
        moreDocs: [DOCS.deploy],
      },
    ],
  },

  // ------------------------------------------------------------------ no comms
  {
    id: "ds-no-comms",
    label: "Driver Station shows no communications",
    summary: "The Communications indicator stays red — the laptop cannot reach the roboRIO at all.",
    synonyms: [
      "no comms",
      "no communication",
      "driver station red",
      "cant connect to robot",
      "cannot connect to the robot",
      "ds not connecting",
      "robot not connecting",
      "no connection to roborio",
    ],
    groundingTerms: ["comms", "communication", "driver station", "connect", "network"],
    entryCheckId: "power",
    checks: [
      {
        id: "power",
        action: "Look at the robot: is the roboRIO Power LED solid green and the radio's power light on?",
        why: "Free, instant, and it is the cause often enough to be worth doing first. A tripped main breaker or an unpowered radio produces exactly this symptom.",
        minutes: 1,
        doc: DOCS.statusLights,
        outcomes: [
          {
            id: "unpowered",
            label: "Something is dark — rio or radio",
            rulesOut: "No networking theory is needed; part of the robot has no power.",
            next: { kind: "fix", fixId: "power-chain" },
          },
          {
            id: "powered",
            label: "Both are powered",
            rulesOut: "Power delivery is eliminated. The problem is in the link between laptop and rio.",
            next: { kind: "check", checkId: "link-type" },
          },
        ],
      },
      {
        id: "link-type",
        action: "Decide which single link you are going to make work first: USB, Ethernet, or the radio over Wi-Fi.",
        why: "Debugging three paths at once is why teams stay stuck for hours. Pick the simplest one that proves the rio is alive, then add complexity back.",
        minutes: 2,
        doc: DOCS.ipConfig,
        outcomes: [
          {
            id: "usb",
            label: "USB — simplest, works in the pit",
            rulesOut: "Radio, Wi-Fi and switch hardware are all taken out of the picture.",
            next: { kind: "check", checkId: "usb-link" },
          },
          {
            id: "ethernet",
            label: "Ethernet cable straight to the rio",
            rulesOut: "Wi-Fi and radio configuration are out of the picture; cabling and IP remain.",
            next: { kind: "check", checkId: "eth-link" },
          },
          {
            id: "wifi",
            label: "Over the radio on Wi-Fi",
            rulesOut: "Nothing yet — this is the path with the most moving parts.",
            next: { kind: "symptom", symptomId: "radio-not-configured" },
          },
        ],
      },
      {
        id: "usb-link",
        action: "Plug a USB-B data cable straight from the laptop to the roboRIO, wait about thirty seconds, and watch the Driver Station.",
        why: "USB creates its own network to the rio, so it proves the rio is alive and running without involving the radio, IP settings, or the field.",
        minutes: 3,
        doc: DOCS.netTroubleshoot,
        outcomes: [
          {
            id: "green",
            label: "Communications goes green over USB",
            rulesOut: "The roboRIO is healthy and its code path is fine. Everything remaining is network configuration.",
            next: { kind: "fix", fixId: "network-not-rio" },
          },
          {
            id: "still-red",
            label: "Still red even over USB",
            rulesOut: "Radio, Wi-Fi, and IP configuration are eliminated — the laptop cannot reach the rio by ANY path.",
            next: { kind: "check", checkId: "firewall" },
          },
        ],
      },
      {
        id: "eth-link",
        action:
          "Run Ethernet straight from the laptop to the roboRIO, set the laptop adapter to DHCP, and check whether it gets a 10.TE.AM.x address or whether roboRIO-TEAM-FRC.local resolves.",
        why: "A direct cable removes the radio and any switch. If addressing works here, the rio is fine and the radio path is the suspect.",
        minutes: 4,
        doc: DOCS.ipConfig,
        outcomes: [
          {
            id: "no-address",
            label: "No address, and the name does not resolve",
            rulesOut: "The cable path is not producing an address — either the rio is not up or the laptop's IP stack is fighting you.",
            next: { kind: "fix", fixId: "ip-config" },
          },
          {
            id: "address-ok",
            label: "It gets an address or the name resolves, but Comms stays red",
            rulesOut: "Layer-3 addressing works, so the block is above it: firewall, VPN, or a competing adapter.",
            next: { kind: "check", checkId: "firewall" },
          },
        ],
      },
      {
        id: "firewall",
        action:
          "Turn off third-party firewalls and any VPN, disable every network adapter except the one you are using, then close and reopen the Driver Station.",
        why: "This is the most common cause left once the physical link is proven, and it is entirely on the laptop — no robot time needed.",
        minutes: 5,
        doc: DOCS.netTroubleshoot,
        outcomes: [
          {
            id: "fixed",
            label: "Communications goes green",
            rulesOut: "The robot was never the problem.",
            next: { kind: "fix", fixId: "firewall-fix" },
          },
          {
            id: "not-fixed",
            label: "Still red",
            rulesOut: "Power, cabling, addressing and the laptop's software stack are all eliminated.",
            next: { kind: "fix", fixId: "reimage-or-escalate" },
          },
        ],
      },
    ],
    fixes: [
      {
        id: "power-chain",
        title: "Restore power to the rio and radio before debugging anything else",
        steps: [
          "Check the main breaker is pushed in and the battery is connected and charged.",
          "Confirm the radio is fed from the correct dedicated power path — not from a random spare port.",
          "Look for a popped 20 A / 10 A branch breaker feeding the rio or the radio.",
          "Once both show power, re-check the Driver Station before changing anything else.",
        ],
        principle:
          "Comms failures and power failures look identical from the Driver Station. Confirming power first is a one-second check that removes half the search space.",
        doc: DOCS.wiringBest,
        moreDocs: [DOCS.statusLights],
      },
      {
        id: "network-not-rio",
        title: "The rio is healthy — fix the network path you actually compete on",
        steps: [
          "Note that USB works: record this in your log, it is real evidence.",
          "Move to Ethernet next and get that green, then the radio last.",
          "When you get to the radio, re-program it for this season and this team number.",
          "Do not compete on USB — the field uses Ethernet through the radio, so the radio path must be proven before your first match.",
        ],
        principle:
          "Working from the simplest link outward turns one unknown into a sequence of single-variable tests. USB green means every later failure is about the network, not the robot.",
        doc: DOCS.netTroubleshoot,
        moreDocs: [DOCS.radio],
      },
      {
        id: "ip-config",
        title: "Fix the laptop's IP configuration",
        steps: [
          "Set the laptop's Ethernet adapter to obtain an address automatically (DHCP).",
          "Disable Wi-Fi and any virtual adapters (VPN, Hyper-V, VirtualBox) while you test.",
          "If DHCP does not produce an address, set a static 10.TE.AM.5 with mask 255.255.255.0 and retry.",
          "Confirm you can ping 10.TE.AM.2 before you go back to the Driver Station.",
        ],
        principle:
          "FRC addressing is derived from your team number: the rio is 10.TE.AM.2 and everything else on the robot network shares that 10.TE.AM.x block. Knowing the number lets you test with ping instead of guessing.",
        doc: DOCS.ipConfig,
        moreDocs: [DOCS.netTroubleshoot],
      },
      {
        id: "firewall-fix",
        title: "Keep the imaging/driving laptop clean",
        steps: [
          "Leave third-party firewalls and VPNs off on the driver laptop, or add explicit exceptions for the Driver Station.",
          "Keep exactly one active network adapter while driving.",
          "Write this down in the team playbook — this exact fix will be needed again next season by someone who was not here.",
        ],
        principle:
          "The Driver Station needs several UDP and TCP ports both ways. A firewall that blocks one direction produces a red Communications light with no error message anywhere.",
        doc: DOCS.driverStation,
        moreDocs: [DOCS.netTroubleshoot],
      },
      {
        id: "reimage-or-escalate",
        title: "Re-image the rio, then substitute hardware",
        steps: [
          "Re-image the roboRIO with this season's image and the correct team number.",
          "If it still will not talk over USB, try a different roboRIO with the same laptop and cable.",
          "If a second rio also fails, the laptop is the common factor — test with another laptop.",
          "Log what you swapped and what happened; that record is what makes the next occurrence fast.",
        ],
        principle:
          "When cheap causes are exhausted, change exactly one variable at a time and watch whether the symptom follows it. That is substitution testing, and it is how you find hardware faults without guessing.",
        doc: DOCS.imaging,
        moreDocs: [DOCS.netTroubleshoot],
      },
    ],
  },

  // ------------------------------------------------------------------ no robot code
  {
    id: "ds-no-code",
    label: "Driver Station shows no robot code",
    summary: "Communications is green but the Robot Code indicator stays red.",
    synonyms: [
      "no robot code",
      "no code",
      "robot code red",
      "code not running",
      "robot code light is red",
      "deployed but no code",
      "code crashes on the robot",
    ],
    groundingTerms: ["robot code", "crash", "code"],
    entryCheckId: "ever-deployed",
    checks: [
      {
        id: "ever-deployed",
        action: "Check whether code has ever deployed successfully to THIS roboRIO (your deploy log, or the last successful Gradle run).",
        why: "Green comms with red code has two very different causes: code that never arrived, and code that arrived and died. One question separates them.",
        minutes: 1,
        doc: DOCS.driverStation,
        outcomes: [
          {
            id: "never",
            label: "Never — or not since the rio was re-imaged",
            rulesOut: "There is no program to crash. This is a deploy problem wearing a different indicator.",
            next: { kind: "symptom", symptomId: "deploy-fails" },
          },
          {
            id: "yes",
            label: "Yes, a deploy succeeded",
            rulesOut: "The artifact reached the rio, so the failure is at startup or runtime.",
            next: { kind: "check", checkId: "console" },
          },
        ],
      },
      {
        id: "console",
        action: "Open the Driver Station Console (or the Log File Viewer for a past run) and read what the robot program printed.",
        why: "The rio tells you exactly why the program exited. Reading it is faster than any guess, and it is the habit that makes a student self-sufficient.",
        minutes: 3,
        doc: DOCS.dsErrors,
        outcomes: [
          {
            id: "exception",
            label: "An exception / stack trace",
            rulesOut: "Configuration and deployment are eliminated — the program ran and threw.",
            next: { kind: "fix", fixId: "crash-in-init" },
          },
          {
            id: "restarting",
            label: "It starts and restarts over and over",
            rulesOut: "The program starts, so the main class and the artifact are fine; something at startup is fatal every time.",
            next: { kind: "fix", fixId: "crash-loop" },
          },
          {
            id: "silent",
            label: "Nothing at all from the robot program",
            rulesOut: "There is no runtime error to read, which points at the program never being started.",
            next: { kind: "check", checkId: "main-class" },
          },
        ],
      },
      {
        id: "main-class",
        action: "Open build.gradle and check that ROBOT_MAIN_CLASS matches the package and class of your Main / Robot entry point.",
        why: "A renamed package is a silent failure: the deploy succeeds, the rio starts nothing, and the Driver Station just shows red.",
        minutes: 5,
        doc: DOCS.robotProgram,
        outcomes: [
          {
            id: "mismatch",
            label: "They do not match",
            rulesOut: "Nothing is wrong with the rio or the network.",
            next: { kind: "fix", fixId: "main-class" },
          },
          {
            id: "match",
            label: "They match",
            rulesOut: "The entry point is correct, so this is a stale or partial deployment.",
            next: { kind: "check", checkId: "restart-code" },
          },
        ],
      },
      {
        id: "restart-code",
        action: "Use Restart Robot Code from the Driver Station, and if that fails, power-cycle the robot and wait for a full boot.",
        why: "Cheap, and it distinguishes a stuck process from a genuinely broken deployment before you start changing code.",
        minutes: 6,
        doc: DOCS.driverStation,
        outcomes: [
          {
            id: "green",
            label: "Robot Code goes green",
            rulesOut: "The deployed program is fine; something was wedged.",
            next: { kind: "fix", fixId: "transient" },
          },
          {
            id: "red",
            label: "Still red after a full power cycle",
            rulesOut: "Restarts and power cycles are eliminated. Redeploy from a clean build.",
            next: { kind: "fix", fixId: "redeploy-clean" },
          },
        ],
      },
    ],
    fixes: [
      {
        id: "crash-in-init",
        title: "Fix the exception the robot printed",
        steps: [
          "Read the FIRST line of the stack trace — it names the exception type and the line in your code.",
          "A NullPointerException in robotInit almost always means a device was constructed before something it depends on, or a CAN/PWM id points at nothing.",
          "If the trace names a vendor class, confirm the device firmware and the vendor library are the same season.",
          "Fix, redeploy, and watch the Console during the first ten seconds of boot.",
        ],
        principle:
          "An unhandled exception in robotInit kills the program before the Driver Station ever sees it, which is why the symptom is 'no code' rather than 'code with a bug'.",
        doc: DOCS.dsErrors,
        moreDocs: [DOCS.robotProgram],
      },
      {
        id: "crash-loop",
        title: "Break the startup crash loop",
        steps: [
          "Comment out subsystem construction down to a bare Robot class and deploy that.",
          "If the bare program stays green, add subsystems back one at a time until the crash returns — the last one you added owns the fault.",
          "Watch for hardware constructors that throw when a device is missing from the CAN bus.",
          "Record which subsystem it was in the team playbook.",
        ],
        principle:
          "Bisecting by deleting is the fastest way to find a fatal startup fault, because each deploy answers a yes/no question instead of asking you to read all the code.",
        doc: DOCS.dsErrors,
      },
      {
        id: "main-class",
        title: "Point ROBOT_MAIN_CLASS at your real entry point",
        steps: [
          "Set ROBOT_MAIN_CLASS in build.gradle to the fully-qualified name of your Main class (for example frc.robot.Main).",
          "Make sure the package declaration at the top of the file agrees with the folder it lives in.",
          "Run a Gradle clean and redeploy.",
          "Confirm the Console prints your program's startup output.",
        ],
        principle:
          "The rio runs whatever class the build tells it to. Renaming a package in the IDE does not update that setting, so the build keeps succeeding while the robot starts nothing.",
        doc: DOCS.robotProgram,
        moreDocs: [DOCS.deploy],
      },
      {
        id: "transient",
        title: "It recovered — capture why before you move on",
        steps: [
          "Note what you had just changed or plugged in before it wedged.",
          "Check the Driver Station log for the moments before the failure.",
          "If this is the second time, stop treating it as transient and log it in Robot › Failure log.",
          "Save a 'resolved' note here so the next student sees this happened before.",
        ],
        principle:
          "An intermittent fault that is never written down becomes a fault the team rediscovers every season. The log entry is the fix.",
        doc: DOCS.dsLog,
      },
      {
        id: "redeploy-clean",
        title: "Redeploy from a clean build",
        steps: [
          "Run a Gradle clean, then Build Robot Code, then deploy.",
          "Watch the deploy output for a real success line rather than assuming it worked.",
          "If deploy now fails, follow the 'Code will not deploy' walk instead.",
          "If deploy succeeds and Robot Code is still red, re-image the rio and deploy once more.",
        ],
        principle:
          "A partial or stale artifact on the rio can deploy 'successfully' and still not run. A clean build removes the possibility that you are testing yesterday's binary.",
        doc: DOCS.deploy,
        moreDocs: [DOCS.imaging],
      },
    ],
  },

  // ------------------------------------------------------------------ radio
  {
    id: "radio-not-configured",
    label: "Radio is not configured",
    summary: "The robot radio has not been programmed for this team and season, so nothing connects over Wi-Fi.",
    synonyms: [
      "radio not configured",
      "configure the radio",
      "program the radio",
      "radio kiosk",
      "cant find robot wifi",
      "no wifi from the robot",
      "radio setup",
    ],
    groundingTerms: ["radio", "wifi", "wireless"],
    entryCheckId: "radio-power",
    checks: [
      {
        id: "radio-power",
        action: "Look at the radio: is its power light on, fed from the proper 12 V power path for your radio model?",
        why: "Instant, and an underfed radio will boot, brown out, and reboot forever — which looks like a configuration problem.",
        minutes: 1,
        doc: DOCS.radio,
        outcomes: [
          {
            id: "dark",
            label: "No light, or it keeps cycling",
            rulesOut: "Configuration is irrelevant until the radio holds power.",
            next: { kind: "fix", fixId: "radio-power-fix" },
          },
          {
            id: "lit",
            label: "Steady power light",
            rulesOut: "Power delivery to the radio is eliminated.",
            next: { kind: "check", checkId: "radio-programmed" },
          },
        ],
      },
      {
        id: "radio-programmed",
        action: "Ask: has THIS radio been programmed with THIS team number, using this season's official radio configuration utility?",
        why: "Radios keep last season's configuration. An unprogrammed or stale radio is the single most common reason a robot never appears on Wi-Fi.",
        minutes: 4,
        doc: DOCS.radio,
        outcomes: [
          {
            id: "no",
            label: "No, or nobody is sure",
            rulesOut: "Nothing downstream can be trusted until the radio is programmed. Do this first.",
            next: { kind: "fix", fixId: "program-radio" },
          },
          {
            id: "yes",
            label: "Yes, programmed this season",
            rulesOut: "Radio configuration is eliminated; the problem is the laptop's association or the wired link behind the radio.",
            next: { kind: "check", checkId: "radio-ssid" },
          },
        ],
      },
      {
        id: "radio-ssid",
        action: "On the laptop, look for the radio's network (named for your team number) and join it with every other adapter disabled.",
        why: "Separates 'the radio is not broadcasting' from 'the laptop is on the wrong network', which need completely different fixes.",
        minutes: 5,
        doc: DOCS.ipConfig,
        outcomes: [
          {
            id: "not-visible",
            label: "The network does not appear at all",
            rulesOut: "The laptop is fine; the radio is not broadcasting what you programmed.",
            next: { kind: "fix", fixId: "radio-reprogram" },
          },
          {
            id: "wont-join",
            label: "It appears, but the laptop will not stay on it",
            rulesOut: "The radio is broadcasting correctly — the laptop keeps preferring another network.",
            next: { kind: "fix", fixId: "radio-ssid-fix" },
          },
          {
            id: "joined",
            label: "Joined, but the Driver Station is still red",
            rulesOut: "Wireless association works, so the break is between the radio and the roboRIO.",
            next: { kind: "check", checkId: "radio-ethernet" },
          },
        ],
      },
      {
        id: "radio-ethernet",
        action: "Check the Ethernet cable from the roboRIO to the radio: correct port on the radio, fully seated, link light on at both ends.",
        why: "This is the last physical link in the chain and it is easy to knock loose in the pit. Checking it costs a minute.",
        minutes: 6,
        doc: DOCS.wiringBest,
        outcomes: [
          {
            id: "bad-cable",
            label: "No link light, wrong port, or a damaged cable",
            rulesOut: "Configuration and Wi-Fi are eliminated; this is a cable fault.",
            next: { kind: "fix", fixId: "radio-cable" },
          },
          {
            id: "cable-ok",
            label: "Link lights on both ends, correct port",
            rulesOut: "Every physical link and the wireless association are proven — the configuration on the radio is the remaining suspect.",
            next: { kind: "fix", fixId: "radio-reprogram" },
          },
        ],
      },
    ],
    fixes: [
      {
        id: "radio-power-fix",
        title: "Feed the radio from its proper power path",
        steps: [
          "Use the powering method your radio model requires, from the documented port — not an improvised tap.",
          "Confirm the branch breaker feeding it has not popped.",
          "Check the barrel or Power-over-Ethernet connector for a loose or damaged pin.",
          "Re-check for a steady power light before doing anything else.",
        ],
        principle:
          "A radio that browns out reboots silently. Because the symptom appears on the laptop, teams debug the laptop for an hour while the actual fault is a loose 12 V lead.",
        doc: DOCS.radio,
        moreDocs: [DOCS.wiringBest],
      },
      {
        id: "program-radio",
        title: "Program the radio with this season's utility",
        steps: [
          "Download and run this season's official radio configuration utility on a laptop with all other adapters disabled.",
          "Enter your team number and follow the utility's prompts exactly, including any required power-cycle.",
          "Wait for the utility to report success — do not unplug early.",
          "Label the radio with the team number and the season so nobody has to wonder again.",
        ],
        principle:
          "The radio stores your team number, its SSID, and the firewall rules the field expects. Every season's utility writes a different configuration, so 'it worked last year' is not evidence.",
        doc: DOCS.radio,
      },
      {
        id: "radio-ssid-fix",
        title: "Join the robot network cleanly",
        steps: [
          "Disable Wi-Fi auto-connect to your school or venue network on the driver laptop.",
          "Turn off every adapter except the one joining the robot network.",
          "Forget and re-join the robot network so the laptop pulls a fresh address.",
          "Confirm you get a 10.TE.AM.x address before opening the Driver Station.",
        ],
        principle:
          "Laptops silently prefer a known network with internet over one without. Half of 'the radio is broken' reports are a laptop that quietly rejoined the venue Wi-Fi.",
        doc: DOCS.ipConfig,
      },
      {
        id: "radio-cable",
        title: "Replace the roboRIO-to-radio Ethernet run",
        steps: [
          "Swap in a known-good Ethernet cable and confirm link lights at both ends.",
          "Route it away from moving mechanisms and strain-relieve both ends.",
          "Re-check the Driver Station.",
          "Add a spare radio cable to the pit cart — this failure recurs at every event.",
        ],
        principle:
          "The rio-to-radio cable is the only wired link the field depends on, and it lives in the most abused part of the robot. It is a consumable, not permanent infrastructure.",
        doc: DOCS.wiringBest,
        moreDocs: [DOCS.radio],
      },
      {
        id: "radio-reprogram",
        title: "Re-program the radio from scratch, then re-test the chain",
        steps: [
          "Re-run this season's radio configuration utility from the beginning, on a clean laptop.",
          "If the utility cannot see the radio, try the alternate power/reset sequence the docs describe for your radio model.",
          "After a successful program, re-test USB, then Ethernet, then Wi-Fi in that order.",
          "If a second radio behaves the same way, the fault is upstream of the radio — go back to the no-comms walk.",
        ],
        principle:
          "Re-testing the whole chain in order after any change is how you avoid fixing two things at once and learning nothing from either.",
        doc: DOCS.radio,
        moreDocs: [DOCS.netTroubleshoot],
      },
    ],
  },

  // ------------------------------------------------------------------ brownout
  {
    id: "brownout",
    label: "Robot browns out",
    summary: "The robot cuts out, twitches, or resets under load — voltage is collapsing.",
    synonyms: [
      "brownout",
      "brown out",
      "robot resets",
      "robot cuts out",
      "voltage drop",
      "low voltage",
      "robot dies under load",
      "rio reboots during a match",
    ],
    groundingTerms: ["brownout", "voltage", "battery", "power"],
    entryCheckId: "confirm-brownout",
    checks: [
      {
        id: "confirm-brownout",
        action:
          "Open the Driver Station Log File Viewer for that run and look at the battery voltage trace at the moment things went wrong.",
        why: "You need to know whether this is actually a brownout before spending the day on batteries. The log answers it definitively and costs nothing.",
        minutes: 2,
        doc: DOCS.dsLog,
        outcomes: [
          {
            id: "dip",
            label: "Voltage dips toward or below the roboRIO brownout threshold",
            rulesOut: "Code, CAN and comms explanations are eliminated — this is electrical.",
            next: { kind: "check", checkId: "battery-state" },
          },
          {
            id: "steady",
            label: "Voltage stays healthy through the event",
            rulesOut: "It is NOT a brownout. Stop here and diagnose the real symptom.",
            next: { kind: "fix", fixId: "not-a-brownout" },
          },
        ],
      },
      {
        id: "battery-state",
        action: "Find out which battery was on the robot and whether it had been fully charged and load-tested recently.",
        why: "A tired battery is the most common cause and the cheapest to eliminate — swap one in and re-run.",
        minutes: 3,
        doc: DOCS.brownouts,
        outcomes: [
          {
            id: "suspect",
            label: "Unknown, old, or not recently load-tested",
            rulesOut: "Nothing on the robot is implicated yet; test with a known-good pack first.",
            next: { kind: "fix", fixId: "battery-swap" },
          },
          {
            id: "good",
            label: "Freshly charged and load-tested pack",
            rulesOut: "Battery capacity is eliminated. Resistance in the power path or genuine demand is the cause.",
            next: { kind: "check", checkId: "connections" },
          },
        ],
      },
      {
        id: "connections",
        action:
          "With the robot safely powered down, check the battery leads, Anderson connector, main breaker and PDP/PDH lugs for looseness, discoloration, or heat marks.",
        why: "Resistance in the main power path produces exactly this symptom with a perfectly good battery, and it is a safety issue as well as a performance one.",
        minutes: 5,
        doc: DOCS.wiringBest,
        outcomes: [
          {
            id: "found",
            label: "Something is loose, discoloured, or warm",
            rulesOut: "You have a physical cause; do not go looking for a software one.",
            next: { kind: "fix", fixId: "tighten-connections" },
          },
          {
            id: "clean",
            label: "Everything is tight and clean",
            rulesOut: "Battery and connections are both eliminated. The robot is genuinely demanding more current than the pack can deliver.",
            next: { kind: "check", checkId: "simultaneous-draw" },
          },
        ],
      },
      {
        id: "simultaneous-draw",
        action: "In the same log, line the voltage dip up against what the drivers were commanding at that instant.",
        why: "This tells you whether to change the electrical system or the software. It is the last check because it is the most work and the least likely to be needed alone.",
        minutes: 8,
        doc: DOCS.brownouts,
        outcomes: [
          {
            id: "stacked",
            label: "Several high-draw mechanisms were commanded at once",
            rulesOut: "Hardware is fine; the demand profile is the problem, and it is fixable in software.",
            next: { kind: "fix", fixId: "current-limits" },
          },
          {
            id: "single",
            label: "One mechanism, or nothing obviously heavy",
            rulesOut: "Software stacking is eliminated. Something is drawing far more than it should — measure it.",
            next: { kind: "fix", fixId: "power-budget-review" },
          },
        ],
      },
    ],
    fixes: [
      {
        id: "not-a-brownout",
        title: "This is not a brownout — diagnose the real symptom",
        steps: [
          "If the robot lost comms, follow the 'Driver Station shows no communications' walk.",
          "If a mechanism stopped but the robot stayed connected, look at CAN device status instead.",
          "If the code stopped, read the Driver Station Console for an exception.",
          "Record here that voltage was clean — that is a real finding and saves the next student a day.",
        ],
        principle:
          "'It cut out' has several causes with the same feel. Voltage data turns a guess into a fact and prevents a whole afternoon spent replacing healthy batteries.",
        doc: DOCS.dsLog,
      },
      {
        id: "battery-swap",
        title: "Test with a known-good battery and retire the suspect",
        steps: [
          "Put a freshly charged, recently load-tested pack on the robot and repeat the same driving.",
          "If the brownout goes away, mark the suspect pack and load-test it properly before it goes back in rotation.",
          "Log the pack in Robot › Batteries so its history follows it.",
          "Never diagnose power problems with an unlabelled battery.",
        ],
        principle:
          "Battery internal resistance rises with age and abuse. A pack can read 12.8 V at rest and still collapse under a 200 A demand, which is why resting voltage is not a health test.",
        doc: DOCS.brownouts,
      },
      {
        id: "tighten-connections",
        title: "Repair the high-resistance connection",
        steps: [
          "Re-crimp or replace the affected lug, lead, or Anderson connector — do not just tighten a discoloured one.",
          "Confirm the main breaker seats firmly and its terminals are tight.",
          "Check that battery leads are the correct gauge and not damaged inside the insulation.",
          "Re-run the same driving and compare the voltage trace to the previous log.",
        ],
        principle:
          "Every milliohm in the main path shows up as voltage lost under load, and losses scale with current — so a joint that is fine at 20 A can cost volts at 200 A.",
        doc: DOCS.wiringBest,
        moreDocs: [DOCS.brownouts],
      },
      {
        id: "current-limits",
        title: "Shape the demand in software",
        steps: [
          "Set smart current limits on the motor controllers driving the heaviest mechanisms.",
          "Add ramp rates or slew limiting so full command is not applied instantly.",
          "Interlock mechanisms that do not need to run simultaneously.",
          "Re-run and compare the voltage trace; keep the change only if the trace improves.",
        ],
        principle:
          "The roboRIO's brownout protection cuts outputs to save itself. Limiting current in software keeps you above that threshold so you never hand control back to the protection circuit.",
        doc: DOCS.brownouts,
      },
      {
        id: "power-budget-review",
        title: "Measure the actual draw and update the power budget",
        steps: [
          "Read per-channel current from the PDP/PDH and find which channel spikes with the dip.",
          "Compare against the expected draw in Robot › Power budget and update it with the measured number.",
          "Investigate the mechanism drawing more than expected — binding, misalignment, and over-geared mechanisms all show up here.",
          "Re-test and record the new trace.",
        ],
        principle:
          "A power budget is only useful when its numbers came from measurement. Replacing estimates with measured draw is what turns it from paperwork into a diagnostic tool.",
        doc: DOCS.brownouts,
        moreDocs: [DOCS.wiringBest],
      },
    ],
  },

  // ------------------------------------------------------------------ CAN
  {
    id: "can-device-not-found",
    label: "CAN device not found",
    summary: "A motor controller, encoder, or other CAN device does not show up or reports as missing.",
    synonyms: [
      "can device not found",
      "device not on the can bus",
      "motor not detected",
      "cant see the motor controller",
      "can bus error",
      "device id missing",
      "can timeout",
    ],
    groundingTerms: ["can", "can bus", "device id", "motor controller"],
    entryCheckId: "device-lights",
    checks: [
      {
        id: "device-lights",
        action: "Look at the device itself. Is its status LED lit at all?",
        why: "A completely dark device is a power problem, not a bus problem, and you can see it from across the pit.",
        minutes: 1,
        doc: DOCS.statusLights,
        outcomes: [
          {
            id: "dark",
            label: "Completely dark",
            rulesOut: "CAN addressing, termination and firmware are all irrelevant until it has power.",
            next: { kind: "fix", fixId: "no-power-to-device" },
          },
          {
            id: "lit",
            label: "Lit, blinking, or flashing some pattern",
            rulesOut: "The device has power, so this is a bus, addressing, or firmware question.",
            next: { kind: "check", checkId: "scan-bus" },
          },
        ],
      },
      {
        id: "scan-bus",
        action: "Open your vendor's tool (Phoenix Tuner X for CTRE, REV Hardware Client for REV) and scan the bus. Does the device appear anywhere, at any id?",
        why: "One scan distinguishes 'the bus cannot see it' from 'the code is looking at the wrong id' — two problems that produce the identical error in your code.",
        minutes: 3,
        doc: DOCS.canWiring,
        outcomes: [
          {
            id: "wrong-id",
            label: "It appears, but at a different id than the code expects",
            rulesOut: "Wiring and termination are eliminated — the bus is healthy.",
            next: { kind: "fix", fixId: "wrong-id" },
          },
          {
            id: "duplicate",
            label: "Two devices claim the same id, or ids flicker",
            rulesOut: "Physical wiring is probably fine; the address space is in conflict.",
            next: { kind: "fix", fixId: "duplicate-id" },
          },
          {
            id: "absent",
            label: "It does not appear at all",
            rulesOut: "The device has power but is not reaching the bus — suspect the wiring itself.",
            next: { kind: "check", checkId: "termination" },
          },
        ],
      },
      {
        id: "termination",
        action:
          "Confirm the bus has exactly two 120 Ω terminations: the roboRIO's built-in one at one end, and the terminating resistor or jumper at the far end.",
        why: "Wrong termination makes a bus that half works — devices appear and disappear — which is far more confusing than a bus that is simply broken.",
        minutes: 5,
        doc: DOCS.canWiring,
        outcomes: [
          {
            id: "wrong",
            label: "Missing, doubled, or in the wrong place",
            rulesOut: "You have a physical cause; fix it before looking at wire continuity.",
            next: { kind: "fix", fixId: "termination-fix" },
          },
          {
            id: "correct",
            label: "Exactly two, at the two ends",
            rulesOut: "Termination is eliminated. What remains is a break or short in the chain.",
            next: { kind: "check", checkId: "halve-bus" },
          },
        ],
      },
      {
        id: "halve-bus",
        action:
          "Split the bus: unplug the CAN chain just after the last device that DOES show up, re-terminate that shorter bus, and re-scan.",
        why: "Halving turns 'somewhere in twenty connections' into three or four scans. It is the most work in this walk, which is why it comes last.",
        minutes: 7,
        doc: DOCS.canWiring,
        outcomes: [
          {
            id: "segment-found",
            label: "The shortened bus is healthy — the fault is past the cut",
            rulesOut: "Everything upstream of the cut is proven good.",
            next: { kind: "fix", fixId: "bad-segment" },
          },
          {
            id: "still-broken",
            label: "Even the shortened bus misbehaves",
            rulesOut: "Wiring is eliminated all the way back — suspect the device or its firmware.",
            next: { kind: "fix", fixId: "firmware-or-hardware" },
          },
        ],
      },
    ],
    fixes: [
      {
        id: "no-power-to-device",
        title: "Restore power to the device",
        steps: [
          "Check the PDP/PDH channel feeding it and whether that breaker has popped.",
          "Confirm the power leads are seated and correctly polarised.",
          "Compare against your CAN-bus map so you are checking the right channel.",
          "Once its LED lights, re-scan the bus.",
        ],
        principle:
          "CAN carries data, not power. A device with a good CAN connection and no 12 V is invisible to the bus in exactly the same way as one with a cut wire.",
        doc: DOCS.wiringBest,
        moreDocs: [DOCS.statusLights],
      },
      {
        id: "wrong-id",
        title: "Make the device id match what the code expects",
        steps: [
          "In the vendor tool, set the device to the id your code uses — or change the code, whichever your CAN-bus map says is correct.",
          "Update Robot › CAN-bus map so the document and the robot agree.",
          "Power-cycle and re-scan to confirm the id stuck.",
          "Re-deploy and confirm the error is gone.",
        ],
        principle:
          "CAN ids are the contract between your code and the hardware. Keeping one written map that both sides are checked against is what stops this recurring every time a device is swapped.",
        doc: DOCS.canWiring,
      },
      {
        id: "duplicate-id",
        title: "Resolve the duplicate CAN id",
        steps: [
          "Disconnect all but one of the conflicting devices so you can address them individually.",
          "Assign each a unique id, writing them into the CAN-bus map as you go.",
          "Reconnect and re-scan to confirm both appear.",
          "Prefer a numbering convention by subsystem so future collisions are obvious.",
        ],
        principle:
          "Two devices answering to the same id corrupt each other's traffic, so the failure is intermittent and can move between devices — a signature worth recognising.",
        doc: DOCS.canWiring,
      },
      {
        id: "termination-fix",
        title: "Restore correct bus termination",
        steps: [
          "Confirm the roboRIO end provides one 120 Ω termination.",
          "Set the terminating jumper or resistor on the device at the far end of the chain — and only there.",
          "Remove any extra terminators in the middle of the bus.",
          "Re-scan and confirm the whole bus enumerates.",
        ],
        principle:
          "A CAN bus is a transmission line: it needs exactly one terminator at each end. Too few or too many produces reflections, and the symptom is devices that flicker rather than a bus that is cleanly down.",
        doc: DOCS.canWiring,
      },
      {
        id: "bad-segment",
        title: "Repair the faulty segment",
        steps: [
          "Inspect the connectors immediately past your cut for a pulled pin, a swapped CAN-H / CAN-L pair, or a chafed run.",
          "Re-crimp or replace that segment and re-terminate properly.",
          "Re-scan the whole bus with everything reconnected.",
          "Add strain relief where the wire moved — that is why it failed.",
        ],
        principle:
          "Halving a serial chain finds a fault in a logarithmic number of tests instead of a linear one. That is why 'split it in half' beats 'check every connector'.",
        doc: DOCS.canWiring,
        moreDocs: [DOCS.wiringBest],
      },
      {
        id: "firmware-or-hardware",
        title: "Update firmware, then substitute the device",
        steps: [
          "In the vendor tool, confirm the device is running this season's firmware and update it if not.",
          "If it will not take firmware, put a known-good device of the same type in its place on the same wires.",
          "If the replacement works, the original is faulty — tag it and log it in Robot › Failure log.",
          "If the replacement also fails, the fault is in that harness position, not the device.",
        ],
        principle:
          "Firmware and vendor library versions are matched per season. A device on last season's firmware can enumerate, half-work, or refuse entirely — so version it before you condemn it.",
        doc: DOCS.rev,
        moreDocs: [DOCS.ctre, DOCS.canWiring],
      },
    ],
  },

  // ------------------------------------------------------------------ blink codes
  {
    id: "motor-controller-blink-code",
    label: "Motor controller is blinking a code",
    summary: "A controller's status LED is showing a pattern and you need to know what it means.",
    synonyms: [
      "blink code",
      "blinking light on the motor controller",
      "status led",
      "orange blinking",
      "flashing red",
      "what does this light mean",
      "controller led pattern",
    ],
    groundingTerms: ["blink", "led", "motor controller", "status light"],
    entryCheckId: "vendor",
    checks: [
      {
        id: "vendor",
        action: "Identify who made the controller — it is printed on the case.",
        why: "Blink codes are vendor-specific and change between product generations. Vantage will not guess one; it will take you to the vendor's own table.",
        minutes: 1,
        doc: DOCS.statusLights,
        outcomes: [
          {
            id: "rev",
            label: "REV Robotics (SPARK MAX, SPARK Flex, …)",
            rulesOut: "Every other vendor's table is irrelevant.",
            next: { kind: "fix", fixId: "rev-status-led" },
          },
          {
            id: "ctre",
            label: "CTR Electronics (Talon FX, Talon SRX, Victor SPX, …)",
            rulesOut: "Every other vendor's table is irrelevant.",
            next: { kind: "fix", fixId: "ctre-status-led" },
          },
          {
            id: "unsure",
            label: "I cannot tell",
            rulesOut: "Nothing yet — identify the part first.",
            next: { kind: "check", checkId: "identify-device" },
          },
        ],
      },
      {
        id: "identify-device",
        action:
          "Trace the wire back to its PDP/PDH channel and look that channel up in Robot › CAN-bus map, or read the model name on the case label.",
        why: "Your own wiring map is usually faster than squinting at a label behind a mechanism, and it doubles as a check that the map is still accurate.",
        minutes: 3,
        doc: DOCS.canWiring,
        outcomes: [
          {
            id: "rev",
            label: "It is a REV controller",
            rulesOut: "Vendor identified — every other vendor's LED table is now irrelevant.",
            next: { kind: "fix", fixId: "rev-status-led" },
          },
          {
            id: "ctre",
            label: "It is a CTRE controller",
            rulesOut: "Vendor identified — every other vendor's LED table is now irrelevant.",
            next: { kind: "fix", fixId: "ctre-status-led" },
          },
          {
            id: "unknown",
            label: "Still cannot identify it",
            rulesOut: "Nothing — but there is a general procedure that works regardless of vendor.",
            next: { kind: "fix", fixId: "unknown-vendor" },
          },
        ],
      },
    ],
    fixes: [
      {
        id: "rev-status-led",
        title: "Read the pattern off REV's own status-LED table",
        steps: [
          "Open the REV documentation for your exact controller model and find its status-LED table.",
          "Match colour AND pattern (solid, slow blink, fast blink) — colour alone is ambiguous.",
          "Connect the REV Hardware Client and confirm firmware is current for this season before acting on the code.",
          "Write the meaning you found into the team playbook so nobody re-derives it next week.",
        ],
        principle:
          "Vantage deliberately does not memorise vendor blink codes: they change between product revisions, and a confidently wrong answer costs more than a lookup. The skill worth learning is 'go to the vendor table'.",
        doc: DOCS.rev,
        moreDocs: [DOCS.statusLights],
      },
      {
        id: "ctre-status-led",
        title: "Read the pattern off CTRE's own status-LED table",
        steps: [
          "Open the CTR Electronics documentation for your exact controller model and find its status-LED section.",
          "Match colour AND pattern, and note whether the robot was enabled or disabled at the time — many patterns differ.",
          "Connect Phoenix Tuner X and confirm firmware and the Phoenix library are on the same season.",
          "Record the meaning in the team playbook.",
        ],
        principle:
          "Vantage deliberately does not memorise vendor blink codes: they change between product revisions, and a confidently wrong answer costs more than a lookup. The skill worth learning is 'go to the vendor table'.",
        doc: DOCS.ctre,
        moreDocs: [DOCS.statusLights],
      },
      {
        id: "unknown-vendor",
        title: "Narrow it without the vendor table",
        steps: [
          "Note whether the pattern changes when the robot is enabled versus disabled — that alone separates 'no signal' from 'fault'.",
          "Check whether the device shows up on the CAN bus; if it does, use the vendor tool's self-report instead of the LED.",
          "Compare with an identical, working controller on the same robot — a matching pattern means the LED is normal.",
          "Photograph the label and the pattern, then ask in team chat or on Chief Delphi with both.",
        ],
        principle:
          "A status LED is a one-bit-per-blink channel. When you cannot decode it, comparison against a known-good identical device gives you the answer without the table.",
        doc: DOCS.statusLights,
        moreDocs: [DOCS.canWiring],
      },
    ],
  },
];

const SYMPTOM_BY_ID = new Map(SYMPTOMS.map((symptom) => [symptom.id, symptom]));

export type TroubleshootSymptomSummary = {
  id: string;
  label: string;
  summary: string;
  checkCount: number;
  fixCount: number;
};

export function listSymptoms(): TroubleshootSymptomSummary[] {
  return SYMPTOMS.map((symptom) => ({
    id: symptom.id,
    label: symptom.label,
    summary: symptom.summary,
    checkCount: symptom.checks.length,
    fixCount: symptom.fixes.length,
  }));
}

export function symptomById(id: string | null | undefined): TroubleshootSymptom | null {
  if (!id) return null;
  return SYMPTOM_BY_ID.get(id) ?? null;
}

export function checkById(symptom: TroubleshootSymptom, checkId: string): TroubleshootCheck | null {
  return symptom.checks.find((check) => check.id === checkId) ?? null;
}

export function fixById(symptom: TroubleshootSymptom, fixId: string): TroubleshootFix | null {
  return symptom.fixes.find((fix) => fix.id === fixId) ?? null;
}

/** Every doc cited anywhere under one symptom, de-duplicated by URL. */
export function symptomDocs(symptom: TroubleshootSymptom): TroubleshootDoc[] {
  const byUrl = new Map<string, TroubleshootDoc>();
  for (const check of symptom.checks) if (check.doc) byUrl.set(check.doc.url, check.doc);
  for (const fix of symptom.fixes) {
    byUrl.set(fix.doc.url, fix.doc);
    for (const doc of fix.moreDocs ?? []) byUrl.set(doc.url, doc);
  }
  return [...byUrl.values()];
}

// ---------------------------------------------------------------------------
// No-AI matcher. This is what makes the page useful with zero model configured.
// ---------------------------------------------------------------------------

function normalize(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
}

const MATCH_STOPWORDS = new Set([
  "a", "an", "the", "is", "are", "was", "were", "to", "for", "of", "in", "on", "at", "my", "our",
  "we", "i", "it", "and", "but", "not", "no", "cant", "cannot", "wont", "does", "do", "did", "get",
  "help", "stuck", "with", "when", "why", "how", "robot", "team",
]);

export type SymptomMatch = { symptomId: string; label: string; score: number };

/**
 * Rank symptoms against free text using only the curated synonyms. Deterministic,
 * offline, and the fallback whenever the AI layer is absent or returns junk.
 */
export function matchSymptoms(text: string, limit = 3): SymptomMatch[] {
  const q = normalize(text);
  if (!q) return [];
  const words = q.split(" ").filter((word) => word.length > 2 && !MATCH_STOPWORDS.has(word));

  const scored: SymptomMatch[] = [];
  for (const symptom of SYMPTOMS) {
    const pool = [symptom.label, symptom.summary, ...symptom.synonyms, ...symptom.groundingTerms].map(normalize);
    let score = 0;

    for (const phrase of pool) {
      if (!phrase) continue;
      if (phrase === q) score += 100;
      else if (q.includes(phrase) && phrase.length > 4) score += 60;
      else if (phrase.includes(q) && q.length > 4) score += 40;
    }

    if (words.length) {
      const poolWords = new Set(pool.join(" ").split(" ").filter(Boolean));
      let hits = 0;
      for (const word of words) {
        for (const candidate of poolWords) {
          if (candidate === word || candidate.startsWith(word) || word.startsWith(candidate)) {
            hits += 1;
            break;
          }
        }
      }
      if (hits) score += Math.round((hits / words.length) * 50) + hits * 4;
    }

    if (score > 0) scored.push({ symptomId: symptom.id, label: symptom.label, score });
  }

  return scored
    .sort((a, b) => b.score - a.score || a.symptomId.localeCompare(b.symptomId))
    .slice(0, Math.max(1, limit));
}

// ---------------------------------------------------------------------------
// Walking the tree
// ---------------------------------------------------------------------------

export type TroubleshootAnswer = { checkId: string; outcomeId: string };

export type WalkedStep = {
  checkId: string;
  action: string;
  why: string;
  minutes: number;
  /** Set once the student answers this step. */
  answeredOutcomeId: string | null;
  answeredLabel: string | null;
  rulesOut: string | null;
  doc: TroubleshootDoc | null;
};

export type WalkResult = {
  symptomId: string;
  /** Steps already answered, in order. */
  history: WalkedStep[];
  /** The check awaiting an answer, if the walk is not finished. */
  current: TroubleshootCheck | null;
  /** The fix the walk arrived at, if any. */
  fix: TroubleshootFix | null;
  /** Set when an outcome hands off to a different symptom. */
  handoffSymptomId: string | null;
  /** Total minutes of the checks walked so far. */
  minutesSpent: number;
  /** True when an answer referenced a check/outcome that does not exist. */
  invalid: boolean;
};

/**
 * Replay `answers` through the tree. The UI renders `history` (the visible
 * reasoning) plus `current` or `fix`. Storage keeps the same shape in jsonb.
 */
export function walkSymptom(symptomId: string, answers: TroubleshootAnswer[]): WalkResult | null {
  const symptom = symptomById(symptomId);
  if (!symptom) return null;

  const result: WalkResult = {
    symptomId: symptom.id,
    history: [],
    current: null,
    fix: null,
    handoffSymptomId: null,
    minutesSpent: 0,
    invalid: false,
  };

  let cursor: string | null = symptom.entryCheckId;
  const seen = new Set<string>();

  for (const answer of answers) {
    if (cursor === null) break;
    // Answers must arrive in tree order; anything else is a stale client.
    if (answer.checkId !== cursor) {
      result.invalid = true;
      break;
    }
    const check = checkById(symptom, cursor);
    if (!check || seen.has(check.id)) {
      result.invalid = true;
      break;
    }
    seen.add(check.id);

    const outcome = check.outcomes.find((entry) => entry.id === answer.outcomeId);
    if (!outcome) {
      result.invalid = true;
      break;
    }

    result.history.push({
      checkId: check.id,
      action: check.action,
      why: check.why,
      minutes: check.minutes,
      answeredOutcomeId: outcome.id,
      answeredLabel: outcome.label,
      rulesOut: outcome.rulesOut,
      doc: check.doc ?? null,
    });
    result.minutesSpent += check.minutes;

    if (outcome.next.kind === "check") {
      cursor = outcome.next.checkId;
    } else if (outcome.next.kind === "fix") {
      result.fix = fixById(symptom, outcome.next.fixId);
      if (!result.fix) result.invalid = true;
      cursor = null;
    } else {
      result.handoffSymptomId = outcome.next.symptomId;
      cursor = null;
    }
  }

  if (cursor !== null && !result.invalid) {
    result.current = checkById(symptom, cursor);
    if (!result.current) result.invalid = true;
  }

  return result;
}

/** Compact, storable record of a walk — this is what lands in `path` jsonb. */
export type StoredPath = {
  symptomId: string;
  steps: Array<{ checkId: string; outcomeId: string; action: string; observed: string; rulesOut: string }>;
  fixId: string | null;
  fixTitle: string | null;
  docUrls: string[];
  minutesSpent: number;
};

export function storedPath(walk: WalkResult): StoredPath {
  const docUrls = new Set<string>();
  for (const step of walk.history) if (step.doc) docUrls.add(step.doc.url);
  if (walk.fix) docUrls.add(walk.fix.doc.url);
  return {
    symptomId: walk.symptomId,
    steps: walk.history.map((step) => ({
      checkId: step.checkId,
      outcomeId: step.answeredOutcomeId ?? "",
      action: step.action,
      observed: step.answeredLabel ?? "",
      rulesOut: step.rulesOut ?? "",
    })),
    fixId: walk.fix?.id ?? null,
    fixTitle: walk.fix?.title ?? null,
    docUrls: [...docUrls],
    minutesSpent: walk.minutesSpent,
  };
}

/** One-line description of a stored walk, for the team-memory list. */
export function describeStoredPath(path: StoredPath): string {
  const symptom = symptomById(path.symptomId);
  const head = symptom?.label ?? path.symptomId;
  if (path.fixTitle) return `${head} → ${path.fixTitle}`;
  if (path.steps.length) return `${head} → ${path.steps.length} check(s), no fix recorded`;
  return head;
}
