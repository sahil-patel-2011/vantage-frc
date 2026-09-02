/**
 * FRC Code Coach: deterministic, evidence-quoting rule pass over robot source.
 *
 * Every rule reports EVERY hit (capped per rule) with the 1-based line of the
 * quoted text, and carries a teach-not-do lesson (flag → why it bites on match
 * day → the habit that prevents it). Absence-based rules quote the construction
 * line that IS present. Nothing here ever invents a finding for unmatched source.
 */

export type CodeRiskSeverity = "low" | "medium" | "high";

export type CodeRuleLesson = {
  /** What the rule caught, in plain language. */
  flag: string;
  /** Why it bites on match day. */
  explain: string;
  /** The habit that prevents it. */
  habit: string;
};

export type CodeRisk = {
  severity: CodeRiskSeverity;
  pattern: string;
  message: string;
  /** `path:line: quoted source` — the quote is always a substring of the file. */
  evidence: string;
  /** 1-based line of the quoted evidence. */
  line: number;
  lesson?: CodeRuleLesson;
};

export type CodeRuleHit = { index: number; evidence: string };

export type CodeCoachRule = {
  id: string;
  severity: CodeRiskSeverity;
  message: string;
  lesson: CodeRuleLesson;
  /** Every hit in file order. The runner caps at CODE_COACH_MAX_HITS_PER_RULE. */
  match: (text: string, path: string) => CodeRuleHit[];
};

/** Twelve hard-coded CAN ids are twelve findings — but a 4,000-line file cannot flood the table. */
export const CODE_COACH_MAX_HITS_PER_RULE = 25;

function globalRe(re: RegExp): RegExp {
  return new RegExp(re.source, re.flags.includes("g") ? re.flags : `${re.flags}g`);
}

/** Every match of `re` in file order, capped. */
export function allRuleHits(text: string, re: RegExp, cap = CODE_COACH_MAX_HITS_PER_RULE): CodeRuleHit[] {
  const hits: CodeRuleHit[] = [];
  for (const match of text.matchAll(globalRe(re))) {
    if (match.index == null || !match[0]) continue;
    hits.push({ index: match.index, evidence: match[0] });
    if (hits.length >= cap) break;
  }
  return hits;
}

/**
 * The balanced `{ … }` block whose opening brace is at `open`. Braces inside
 * strings/comments are not special-cased; the span cap keeps a malformed file
 * from going quadratic.
 */
export function braceBlock(text: string, open: number, cap = 8000): { start: number; end: number } {
  let depth = 0;
  for (let index = open; index < text.length && index < open + cap; index += 1) {
    const char = text[index];
    if (char === "{") depth += 1;
    else if (char === "}") {
      depth -= 1;
      if (depth === 0) return { start: open + 1, end: index };
    }
  }
  return { start: open + 1, end: Math.min(text.length, open + cap) };
}

/** Hits of `needle` inside every block opened by `header` (header must end with `{`). */
export function hitsInsideBlocks(
  text: string,
  header: RegExp,
  needle: RegExp,
  cap = CODE_COACH_MAX_HITS_PER_RULE,
): CodeRuleHit[] {
  const hits: CodeRuleHit[] = [];
  for (const head of text.matchAll(globalRe(header))) {
    if (head.index == null) continue;
    const open = head.index + head[0].length - 1;
    if (text[open] !== "{") continue;
    const block = braceBlock(text, open);
    const body = text.slice(block.start, block.end);
    for (const inner of body.matchAll(globalRe(needle))) {
      if (inner.index == null || !inner[0]) continue;
      hits.push({ index: block.start + inner.index, evidence: inner[0] });
      if (hits.length >= cap) return hits;
    }
  }
  return hits;
}

/** robotPeriodic / teleopPeriodic / periodic / execute — the 20 ms bodies. */
export const PERIODIC_HEADER =
  /\b(?:robot|teleop|autonomous|disabled|simulation|test)?[Pp]eriodic\s*\(\s*\)\s*(?:throws\s+[\w.,\s]+?)?\{|\bexecute\s*\(\s*\)\s*(?:throws\s+[\w.,\s]+?)?\{/;

/** `for (…) {` / `while (…) {` headers. */
const TIGHT_LOOP_HEADER = /\b(?:for\s*\([^{]*?\)|while\s*\([^{;]*?\))\s*\{/;

const CAN_DEVICE_CTOR =
  /\bnew\s+(TalonFX|TalonFXS|CANSparkMax|CANSparkFlex|SparkMax|SparkFlex|TalonSRX|VictorSPX|CANcoder|CANCoder|Pigeon2|CANdle|PowerDistribution)\s*\(\s*(\d{1,2})\b/;

/** Same device class + same CAN id twice in one file is a guaranteed bus conflict. */
export function duplicateCanIdHits(text: string, cap = CODE_COACH_MAX_HITS_PER_RULE): CodeRuleHit[] {
  const seen = new Set<string>();
  const hits: CodeRuleHit[] = [];
  for (const match of text.matchAll(globalRe(CAN_DEVICE_CTOR))) {
    if (match.index == null) continue;
    const key = `${(match[1] ?? "").toLowerCase()}:${match[2] ?? ""}`;
    if (seen.has(key)) {
      hits.push({ index: match.index, evidence: match[0] });
      if (hits.length >= cap) break;
    } else {
      seen.add(key);
    }
  }
  return hits;
}

const MOTOR_CTOR = /\b(?:TalonFX|TalonFXS|SparkMax|SparkFlex|TalonSRX|VictorSPX|CANSparkMax|CANSparkFlex)\s*\(/;
const CURRENT_LIMIT_API =
  /\b(?:setSupplyCurrentLimit|ConfigSupplyCurrentLimit|withSupplyCurrentLimit|setSmartCurrentLimit|smartCurrentLimit|SupplyCurrentLimit|StatorCurrentLimit|CurrentLimitsConfigs)\b/;

/** Flag motor construction only when the pasted source has no current-limit API — never invent a motor. */
export function missingSupplyCurrentLimit(text: string): { evidence: string; index: number } | null {
  const motor = MOTOR_CTOR.exec(text);
  if (!motor || motor.index == null) return null;
  if (CURRENT_LIMIT_API.test(text)) return null;
  return { evidence: motor[0], index: motor.index };
}

/** A hardware map file: literal ports belong here and nowhere else. */
function isConstantsFile(text: string, path: string): boolean {
  const base = path.replace(/\\/g, "/").split("/").pop() ?? path;
  if (/constants?/i.test(base)) return true;
  if (/(^|\/)constants?(\/|$)/i.test(path.replace(/\\/g, "/"))) return true;
  return /\bclass\s+\w*Constants\b/.test(text);
}

/** Guarded rule: fires on `re` only when the whole file lacks `absent`. */
function hitsUnless(text: string, re: RegExp, absent: RegExp): CodeRuleHit[] {
  if (absent.test(text)) return [];
  return allRuleHits(text, re);
}

export const CODE_COACH_RULES: CodeCoachRule[] = [
  {
    id: "blocking-robot-loop",
    severity: "high",
    message: "Blocking the robot loop can starve command scheduling and safety feeds.",
    lesson: {
      flag: "Blocking call inside the robot loop",
      explain:
        "Timer.delay / Thread.sleep stalls command scheduling, sensor reads, and safety feeds for the entire delay.",
      habit: "Use timestamps or stateful commands so the loop keeps running while work advances on a schedule.",
    },
    match: (text) => allRuleHits(text, /\b(?:Thread\.sleep|Timer\.delay)\s*\(/),
  },
  {
    id: "hardcoded-can-id",
    severity: "high",
    message: "Hard-coded CAN IDs can collide; use one reviewed hardware map.",
    lesson: {
      flag: "Hard-coded CAN device construction",
      explain:
        "Inline IDs collide when two subsystems claim the same bus address or a map drifts from the wiring sheet.",
      habit: "Keep one reviewed hardware map (constants / generated config) and construct devices from that map only.",
    },
    match: (text) =>
      allRuleHits(
        text,
        /\b(?:TalonFX|TalonFXS|SparkMax|SparkFlex|CANSparkMax|CANSparkFlex|TalonSRX|VictorSPX|CANcoder|CANCoder|Pigeon2|CANdle)\s*\(\s*\d+/,
      ),
  },
  {
    id: "unbounded-motor-output",
    severity: "medium",
    message: "Motor output appears outside the normalized range; clamp or use a typed control request.",
    lesson: {
      flag: "Motor output outside a normalized range",
      explain:
        "Raw set() values beyond ±1 (or vendor limits) can demand unsafe current or saturate control unexpectedly.",
      habit: "Clamp demands or use typed control requests (DutyCycleOut, VoltageOut) with explicit units and soft limits.",
    },
    match: (text) => allRuleHits(text, /\.set\s*\(\s*(?:[2-9]|-\d)/),
  },
  {
    id: "missing-unit-signal",
    severity: "medium",
    message: "A physical value has no visible unit; use WPILib units or encode the unit in the name.",
    lesson: {
      flag: "Physical value without a unit signal",
      explain: "Bare numbers for distance/velocity/angle invite inch/meter mix-ups under match pressure.",
      habit: "Use WPILib units or encode the unit in the name (metersPerSecond, degrees) so reviews catch scale errors.",
    },
    match: (text) => allRuleHits(text, /\b(?:distance|velocity|angle|speed)\s*[=:]\s*\d+(?:\.\d+)?\b/i),
  },
  {
    id: "disabled-state-mutation",
    severity: "high",
    message: "Actuator output in disabled callbacks requires explicit safety review.",
    lesson: {
      flag: "Actuator write in a disabled callback",
      explain: "Output during disabledInit/Periodic can move mechanisms when the robot should be safe.",
      habit: "Keep disabled paths read-only unless a mentor-reviewed safety procedure explicitly allows a hold/brake.",
    },
    match: (text) => allRuleHits(text, /\bdisabled(?:Init|Periodic)\b[\s\S]{0,500}?\.(?:set|drive)\s*\(/i),
  },
  {
    id: "missing-supply-current-limit",
    severity: "high",
    message:
      "Motor controllers are constructed without a supply current limit in this source — brownouts and main-breaker trips follow.",
    lesson: {
      flag: "Motor constructed without a supply current limit",
      explain:
        "Uncapped swerve and mechanisms brown out the RIO and trip the main breaker. Supply limits protect the battery; stator limits protect the motor.",
      habit: "Set supply current limits on every motor in the same file that constructs the controller — never deploy without them.",
    },
    match: (text) => {
      const missing = missingSupplyCurrentLimit(text);
      return missing ? [missing] : [];
    },
  },
  {
    id: "can-id-collision",
    severity: "high",
    message:
      "The same device class is constructed twice with the same CAN id in this file — one of the two will not respond and the mechanism dies mid-match.",
    lesson: {
      flag: "Duplicate CAN id on the same device class",
      explain:
        "Two controllers answering one id fight over the bus: one silently drops frames, so a mechanism stops responding mid-match with no error on the dashboard.",
      habit: "Assign ids once in a hardware map, keep it next to the wiring sheet, and let Phoenix Tuner / REV client confirm every id before enable.",
    },
    match: (text) => duplicateCanIdHits(text),
  },
  {
    id: "unbounded-loop-in-periodic",
    severity: "high",
    message:
      "An unbounded while/for loop runs inside a periodic()/execute() body — the 20 ms loop blocks until the condition flips, and the watchdog reports overruns.",
    lesson: {
      flag: "Unbounded loop inside a 20 ms body",
      explain:
        "`while (!sensor.get())` inside periodic waits on hardware from the scheduler thread; nothing else runs, motor safety times out, and the robot stutters or stops.",
      habit: "Make the loop a state machine or a command with isFinished() — check the condition once per tick and return.",
    },
    match: (text) =>
      hitsInsideBlocks(
        text,
        PERIODIC_HEADER,
        /\bwhile\s*\(\s*(?:true\b|!|[\w.()]+\s*(?:[<>]=?|!=|==)\s*[\w.()-]+\s*\))|\bfor\s*\(\s*;\s*;\s*\)/,
      ),
  },
  {
    id: "hardcoded-io-port",
    severity: "medium",
    message:
      "A PWM/DIO/analog port is hard-coded outside the Constants class — port changes at the event have to be hunted down file by file.",
    lesson: {
      flag: "Literal roboRIO port outside Constants",
      explain:
        "When a DIO channel or PWM port is rewired in the pit, every literal scattered through subsystems is a place to miss — and a missed one silently reads the wrong sensor.",
      habit: "Declare every port once in Constants (or a hardware map) and construct devices from those names only.",
    },
    match: (text, path) =>
      isConstantsFile(text, path)
        ? []
        : allRuleHits(
            text,
            /\bnew\s+(?:PWMSparkMax|PWMSparkFlex|PWMVictorSPX|PWMTalonSRX|PWMTalonFX|Spark|VictorSP|Talon|Victor|Jaguar|Servo|DigitalInput|DigitalOutput|AnalogInput|AnalogPotentiometer|AnalogGyro|Encoder|DutyCycleEncoder|DutyCycle|Counter|Relay|Ultrasonic|PWM)\s*\(\s*\d+/,
          ),
  },
  {
    id: "motor-safety-disabled",
    severity: "high",
    message:
      "Motor safety is switched off, so a hung loop or lost packet leaves the output latched instead of neutralling the drive.",
    lesson: {
      flag: "Motor safety disabled",
      explain:
        "setSafetyEnabled(false) removes the watchdog that stops motors when the loop stalls or comms drop — the drive keeps the last command until someone hits E-stop.",
      habit: "Leave motor safety on and feed it from the loop that really commands the motor; if a control path needs it off, document why in review.",
    },
    match: (text) => allRuleHits(text, /\.setSafetyEnabled\s*\(\s*false\s*\)/),
  },
  {
    id: "brownout-handling-missing",
    severity: "medium",
    message:
      "A PowerDistribution hub is constructed but nothing in this file checks brownout or battery voltage — the code cannot shed load before the roboRIO resets.",
    lesson: {
      flag: "PDH present, no brownout / voltage check",
      explain:
        "The RIO browns out at ~6.8 V; without reading voltage or isBrownedOut() the code keeps commanding full output right through the sag and loses the match on a reboot.",
      habit: "Read RobotController.getBatteryVoltage() / isBrownedOut() each loop and drop mechanism output (or delay the climb) when it dips.",
    },
    match: (text) =>
      hitsUnless(
        text,
        /\bnew\s+PowerDistribution(?:Panel)?\s*\(/,
        /\b(?:getBrownedOut|isBrownedOut|getVoltage|getBatteryVoltage|getInputVoltage|BrownoutVoltage|getFaults)\b/,
      ),
  },
  {
    id: "follower-inversion-unstated",
    severity: "low",
    message:
      "A follower is configured without an explicit inversion flag — opposing motor pairs fight each other if the default is wrong for this gearbox.",
    lesson: {
      flag: "follow() without an explicit invert",
      explain:
        "Two motors on one gearbox often face opposite directions; a follower that defaults to 'same direction' stalls the pair at full current and trips the breaker.",
      habit: "Always pass the invert flag to follow()/Follower and confirm the direction on blocks before the first drive test.",
    },
    match: (text) => allRuleHits(text, /\.follow\s*\(\s*[\w.]+(?:\(\))?\s*\)/),
  },
  {
    id: "deprecated-wpilib-api",
    severity: "medium",
    message:
      "A deprecated or removed WPILib / vendor API is used — it stops compiling on the next season's WPILib and blocks the kickoff update.",
    lesson: {
      flag: "Deprecated / removed WPILib or vendor API",
      explain:
        "Old PIDController, SpeedControllerGroup, the pre-2020 command framework, CANSparkMax and Phoenix 5 TalonFX classes have all been removed; the first gradle build after the season update fails.",
      habit: "Migrate at season start (edu.wpi.first.math.controller.PIDController, wpilibj2 commands, SparkMax, Phoenix 6) and read the WPILib changelog before kickoff.",
    },
    match: (text) =>
      allRuleHits(
        text,
        /\bedu\.wpi\.first\.wpilibj\.(?:PIDController|PIDSubsystem|PIDCommand|PIDSource|PIDOutput|SpeedController|SpeedControllerGroup|PWMSpeedController|command\.[\w.]+)\b|\bSpeedControllerGroup\b|\bDriverStation\.getInstance\s*\(|\bnew\s+CANSparkMax\s*\(|\bWPI_TalonFX\b|\bcom\.ctre\.phoenix\.motorcontrol\.can\.(?:WPI_)?TalonFX\b|\b(?:CommandBase|PerpetualCommand|ProfiledPIDSubsystem|ProfiledPIDCommand|TrapezoidProfileSubsystem|TrapezoidProfileCommand)\b/,
      ),
  },
  {
    id: "dashboard-put-in-tight-loop",
    severity: "low",
    message:
      "SmartDashboard/Shuffleboard writes run inside a tight loop — each call is a NetworkTables publish, and the loop floods the table and the loop time.",
    lesson: {
      flag: "Dashboard publish inside a for/while loop",
      explain:
        "Publishing per iteration multiplies NetworkTables traffic and string formatting; the dashboard lags and the 20 ms budget goes to telemetry instead of control.",
      habit: "Publish once per loop tick (or throttle) and log high-rate data with a data logger instead of the dashboard.",
    },
    match: (text) =>
      hitsInsideBlocks(text, TIGHT_LOOP_HEADER, /\b(?:SmartDashboard\.put\w+|Shuffleboard\.getTab)\s*\(/),
  },
  {
    id: "empty-catch-block",
    severity: "medium",
    message:
      "An exception is swallowed by an empty catch block — a CAN timeout or config failure vanishes instead of reaching the Driver Station.",
    lesson: {
      flag: "Empty catch block",
      explain:
        "Config calls, file reads and vendor APIs throw when hardware is missing; an empty catch hides the failure until the mechanism does nothing on the field.",
      habit: "At minimum DriverStation.reportError() the exception; better, fail loudly at robotInit so the pit crew sees it before the match.",
    },
    match: (text) =>
      allRuleHits(text, /\bcatch\s*\([^)]*\)\s*\{\s*(?:\/\/[^\n]*\s*|\/\*[\s\S]*?\*\/\s*)*\}/),
  },
  {
    id: "loop-overrun-print",
    severity: "medium",
    message:
      "Printing from a 20 ms loop is a well-known loop-overrun source — move it behind an epilogue logger or a throttled counter.",
    lesson: {
      flag: "System.out.println inside a periodic body",
      explain:
        "Console output from the RIO goes over the network every tick; under load it blocks the loop and shows up as watchdog overruns during a match.",
      habit: "Log with DataLogManager / Epilogue, or throttle prints to once a second behind a counter.",
    },
    match: (text) => hitsInsideBlocks(text, PERIODIC_HEADER, /\bSystem\.out\.print(?:ln|f)?\s*\(/),
  },
  {
    id: "missing-scheduler-run",
    severity: "high",
    message:
      "This command-based robot defines robotPeriodic() without CommandScheduler.getInstance().run() — no command or subsystem periodic ever executes.",
    lesson: {
      flag: "robotPeriodic without CommandScheduler.run()",
      explain:
        "The scheduler is what calls every subsystem's periodic() and every command's execute(); without run() the robot enables and does nothing — default commands included.",
      habit: "Keep exactly one CommandScheduler.getInstance().run() in robotPeriodic(), first line, and never remove it while refactoring.",
    },
    match: (text) => {
      if (!/\bCommandScheduler\b|\bRobotContainer\b|\bwpilibj2\b/.test(text)) return [];
      if (/CommandScheduler\.getInstance\s*\(\s*\)\s*\.run\s*\(/.test(text)) return [];
      return allRuleHits(text, /\brobotPeriodic\s*\(\s*\)\s*\{/, 1);
    },
  },
  {
    id: "hardcoded-alliance-colour",
    severity: "high",
    message:
      "Alliance colour is hard-coded — auto paths and field-relative targets mirror the wrong way for half of the matches at an event.",
    lesson: {
      flag: "Alliance colour set as a literal",
      explain:
        "The FMS assigns Red or Blue per match; a literal survives the practice field and then drives into the wrong side of the field in qualification 3.",
      habit: "Read DriverStation.getAlliance() (checking isPresent) at auto init and flip paths from that value — never from a constant.",
    },
    match: (text) =>
      allRuleHits(
        text,
        /\b(?:(?:final\s+)?(?:DriverStation\.)?Alliance\s+\w+|var\s+\w+)\s*=\s*(?:DriverStation\.)?Alliance\.(?:Red|Blue)\b|\b(?:is|on)(?:Red|Blue)(?:Alliance)?\s*=\s*(?:true|false)\b|\breturn\s+(?:DriverStation\.)?Alliance\.(?:Red|Blue)\s*;/,
      ),
  },
];

/** Lessons keyed by rule id — for narration catalogs and the "why" panel. */
export const CODE_COACH_LESSONS: Record<string, CodeRuleLesson> = Object.fromEntries(
  CODE_COACH_RULES.map((rule) => [rule.id, rule.lesson]),
);

function lineOf(text: string, index: number): number {
  return text.slice(0, index).split(/\r?\n/).length;
}

export function reviewFrcCode(input: { path: string; content: string; diff?: string }) {
  const text = input.diff ?? input.content;
  const risks: CodeRisk[] = [];
  for (const rule of CODE_COACH_RULES) {
    const hits = rule.match(text, input.path).slice(0, CODE_COACH_MAX_HITS_PER_RULE);
    // One finding per rule per line: `SpeedControllerGroup x = new SpeedControllerGroup(...)`
    // is one problem, not two.
    const linesSeen = new Set<number>();
    for (const hit of hits) {
      const line = lineOf(text, hit.index);
      if (linesSeen.has(line)) continue;
      linesSeen.add(line);
      risks.push({
        severity: rule.severity,
        pattern: rule.id,
        message: rule.message,
        evidence: `${input.path}:${line}: ${hit.evidence.replace(/\s+/g, " ").slice(0, 100)}`,
        line,
        lesson: rule.lesson,
      });
    }
  }
  return {
    path: input.path,
    risks,
    riskLevel: risks.some((risk) => risk.severity === "high")
      ? ("high" as const)
      : risks.some((risk) => risk.severity === "medium")
        ? ("medium" as const)
        : ("low" as const),
    requiredChecks: [
      "Run unit/simulation tests before deploying to a robot.",
      "Review CAN IDs, current limits, inversion, neutral mode, and mechanism soft limits.",
      "Test enable/disable transitions with the robot safely supported.",
    ],
    artifact: {
      kind: "coding_review",
      title: `FRC code risk review: ${input.path}`,
      claimProvenance: risks.map((risk) => ({
        claim: risk.message,
        classification: "model_inference",
        sourceIds: [`file:${input.path}`],
      })),
    },
  };
}

export function buildDiffProposal(input: {
  path: string;
  summary: string;
  unifiedDiff: string;
  review: ReturnType<typeof reviewFrcCode>;
}) {
  if (!input.unifiedDiff.startsWith("--- ") || !input.unifiedDiff.includes("\n+++ "))
    throw new Error("Coding proposals must use unified diff format");
  return {
    kind: "code_diff",
    title: input.summary,
    path: input.path,
    unifiedDiff: input.unifiedDiff,
    riskLevel: input.review.riskLevel,
    risks: input.review.risks,
    requiresHumanApproval: true,
    executionState: "proposal_only" as const,
  };
}
