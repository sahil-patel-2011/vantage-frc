/**
 * Authored engineering knowledge used by agent narration ("show your work").
 *
 * Every entry is keyed by an identifier that must appear in REAL agent output — a rule id that
 * actually matched, or a tool name that actually ran. Nothing here is ever attached to a
 * narration unless that exact key was present in the data, and nothing here names a specific
 * robot, file, number, or dimension: those only ever come from the data itself.
 *
 * This is the difference between teaching and fabricating. A principle is a general practice
 * tied to an operation type. It is never presented as the reason a particular step happened —
 * that reason has to be carried by the step.
 */

export type CodeRuleLesson = {
  /** What the rule caught, in plain language. */
  flag: string;
  /** Why it bites on match day. */
  explain: string;
  /** The habit that prevents it. */
  habit: string;
};

/**
 * Teach-not-do lessons keyed by coding-assistant / Bugbot pattern ids.
 * Only rendered for a rule that actually matched evidence in the student's source.
 */
export const CODE_RULE_LESSONS: Record<string, CodeRuleLesson> = {
  "blocking-robot-loop": {
    flag: "Blocking call inside the robot loop",
    explain:
      "Timer.delay / Thread.sleep stalls command scheduling, sensor reads, and safety feeds for the entire delay.",
    habit:
      "Use timestamps or stateful commands so the loop keeps running while work advances on a schedule.",
  },
  "hardcoded-can-id": {
    flag: "Hard-coded CAN device construction",
    explain:
      "Inline IDs collide when two subsystems claim the same bus address or a map drifts from the wiring sheet.",
    habit:
      "Keep one reviewed hardware map (constants / generated config) and construct devices from that map only.",
  },
  "unbounded-motor-output": {
    flag: "Motor output outside a normalized range",
    explain:
      "Raw set() values beyond ±1 (or vendor limits) can demand unsafe current or saturate control unexpectedly.",
    habit:
      "Clamp demands or use typed control requests (DutyCycleOut, VoltageOut) with explicit units and soft limits.",
  },
  "missing-unit-signal": {
    flag: "Physical value without a unit signal",
    explain: "Bare numbers for distance/velocity/angle invite inch/meter mix-ups under match pressure.",
    habit:
      "Use WPILib units or encode the unit in the name (metersPerSecond, degrees) so reviews catch scale errors.",
  },
  "disabled-state-mutation": {
    flag: "Actuator write in a disabled callback",
    explain: "Output during disabledInit/Periodic can move mechanisms when the robot should be safe.",
    habit:
      "Keep disabled paths read-only unless a mentor-reviewed safety procedure explicitly allows a hold/brake.",
  },
  "missing-supply-current-limit": {
    flag: "Motor constructed without a supply current limit",
    explain:
      "Uncapped swerve and mechanisms brown out the RIO and trip the main breaker. Supply limits protect the battery; stator limits protect the motor.",
    habit:
      "Set supply current limits on every motor in the same file that constructs the controller — never deploy without them.",
  },
};

/**
 * General engineering practice for an operation type, keyed by the exact tool name the agent ran.
 * Deliberately free of specific dimensions — the numbers in a narration come from the tool params.
 */
export const TOOL_PRINCIPLES: Record<string, string> = {
  onshape_sketch_rectangle:
    "Dimension from the datum that must not move — a bore, a mounting face, a frame rail — not from an outside edge, so the sketch survives a resize.",
  onshape_extrude:
    "Depth is a driving dimension. Tie it to stock thickness rather than retyping a number, so the feature updates when the material changes.",
  onshape_describe:
    "Read the existing feature tree before adding to it: a feature added on the wrong parent is the usual cause of a rebuild that will not.",
  onshape_bind:
    "Bind to one Part Studio explicitly. Ambiguity about which document is live is how a review ends up looking at last week's geometry.",
  onshape_list_documents:
    "Confirm which document you are editing before you edit it — the most expensive CAD mistake is a correct change in the wrong place.",
  onshape_list_elements:
    "Confirm which document you are editing before you edit it — the most expensive CAD mistake is a correct change in the wrong place.",
  fusion_sketch_rectangle:
    "Dimension from the datum that must not move — a bore, a mounting face, a frame rail — not from an outside edge, so the sketch survives a resize.",
  fusion_extrude:
    "Depth is a driving dimension. Tie it to stock thickness rather than retyping a number, so the feature updates when the material changes.",
  fusion_describe:
    "Read the existing feature tree before adding to it: a feature added on the wrong parent is the usual cause of a rebuild that will not.",
  fusion_status:
    "Check the connection before you trust the result. A tool that silently did nothing looks identical to a tool that worked.",
  cad_status:
    "Check the connection before you trust the result. A tool that silently did nothing looks identical to a tool that worked.",
  "web.search":
    "Search is for finding the primary document, not for the answer. The manual, the vendor datasheet, and the WPILib docs outrank a summary of them.",
  "web.fetch":
    "Cite the primary source. A claim you cannot trace back to a document is a claim you cannot defend at inspection.",
};

/** Practice attached to a ReAct loop step kind, not to any particular tool. */
export const STEP_KIND_PRINCIPLES: Record<string, string> = {
  observe:
    "Only what is fed back into context can be used by the next step. Anything the agent 'remembers' without an observation is a guess.",
  generation:
    "The final answer may only assert what the recorded steps support. Unsupported confidence is the failure mode to watch for.",
};
