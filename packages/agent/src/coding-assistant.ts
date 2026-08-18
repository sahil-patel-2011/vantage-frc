export type CodeRisk = {
  severity: "low" | "medium" | "high";
  pattern: string;
  message: string;
  evidence: string;
};

const RULES: Array<{
  severity: CodeRisk["severity"];
  pattern: string;
  test: RegExp;
  message: string;
}> = [
  {
    severity: "high",
    pattern: "blocking-robot-loop",
    test: /\b(Thread\.sleep|Timer\.delay)\s*\(/,
    message: "Blocking the robot loop can starve command scheduling and safety feeds.",
  },
  {
    severity: "high",
    pattern: "hardcoded-can-id",
    test: /\b(?:TalonFX|SparkMax|CANcoder|Pigeon2)\s*\(\s*\d+/,
    message: "Hard-coded CAN IDs can collide; use one reviewed hardware map.",
  },
  {
    severity: "medium",
    pattern: "unbounded-motor-output",
    test: /\.set\s*\(\s*(?:[2-9]|-\d)/,
    message: "Motor output appears outside the normalized range; clamp or use a typed control request.",
  },
  {
    severity: "medium",
    pattern: "missing-unit-signal",
    test: /\b(?:distance|velocity|angle|speed)\s*[=:]\s*\d+(?:\.\d+)?\b/i,
    message: "A physical value has no visible unit; use WPILib units or encode the unit in the name.",
  },
  {
    severity: "high",
    pattern: "disabled-state-mutation",
    test: /\bdisabled(?:Init|Periodic)\b[\s\S]{0,500}\.(?:set|drive)\s*\(/i,
    message: "Actuator output in disabled callbacks requires explicit safety review.",
  },
];

const MOTOR_CTOR = /\b(?:TalonFX|SparkMax|SparkFlex|TalonSRX|VictorSPX|CANSparkMax)\s*\(/;
const CURRENT_LIMIT_API =
  /\b(?:setSupplyCurrentLimit|ConfigSupplyCurrentLimit|withSupplyCurrentLimit|setSmartCurrentLimit|SupplyCurrentLimit|StatorCurrentLimit|CurrentLimitsConfigs)\b/;

/** Flag motor construction only when the pasted source has no current-limit API — never invent a motor. */
export function missingSupplyCurrentLimit(text: string): { evidence: string; index: number } | null {
  const motor = MOTOR_CTOR.exec(text);
  if (!motor || motor.index == null) return null;
  if (CURRENT_LIMIT_API.test(text)) return null;
  return { evidence: motor[0], index: motor.index };
}

export function reviewFrcCode(input: { path: string; content: string; diff?: string }) {
  const text = input.diff ?? input.content;
  const risks: CodeRisk[] = [];
  for (const rule of RULES) {
    const match = rule.test.exec(text);
    if (!match) continue;
    const line = text.slice(0, match.index).split(/\r?\n/).length;
    risks.push({
      severity: rule.severity,
      pattern: rule.pattern,
      message: rule.message,
      evidence: `${input.path}:${line}: ${match[0].replace(/\s+/g, " ").slice(0, 100)}`,
    });
  }
  const missingLimit = missingSupplyCurrentLimit(text);
  if (missingLimit) {
    const line = text.slice(0, missingLimit.index).split(/\r?\n/).length;
    risks.push({
      severity: "high",
      pattern: "missing-supply-current-limit",
      message:
        "Motor controllers are constructed without a supply current limit in this source — brownouts and main-breaker trips follow.",
      evidence: `${input.path}:${line}: ${missingLimit.evidence.replace(/\s+/g, " ").slice(0, 100)}`,
    });
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
