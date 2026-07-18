/**
 * Game-rule compliance — pure checker used by Assistant / CAD / Strategy tools.
 * Flags design proposals against stored constraints and open rule questions.
 */

export type ComplianceSeverity = "block" | "warn" | "info";

export type ComplianceFinding = {
  severity: ComplianceSeverity;
  ruleRef: string;
  message: string;
  matchedConstraint: string;
};

export type RuleNoteLite = {
  question: string;
  answer?: string;
  ruleRef?: string;
  status?: string;
};

export type ComplianceReport = {
  status: "pass" | "warn" | "fail";
  findings: ComplianceFinding[];
  adviceLabel: "MODEL";
  disclaimer: string;
};

const DISCLAIMER =
  "MODEL compliance hints cite your team's stored constraints and rule notes only — not official FIRST rulings.";

const HARD_CONSTRAINT_RE =
  /\b(must not|may not|cannot|shall not|prohibited|illegal|foul|weight|lbs?\b|kg\b|size|extension|perimeter|frame|bumper|height|width|length|inspection)\b/i;

const DIMENSION_RE =
  /\b(\d+(?:\.\d+)?)\s*(?:in(?:ch(?:es)?)?|mm|cm|ft|feet|lbs?|pounds?|kg)\b/gi;

function normalize(text: string) {
  return text.toLowerCase().replace(/\s+/g, " ").trim();
}

function significantTokens(text: string): string[] {
  return normalize(text)
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length >= 4)
    .filter((token) => !["must", "shall", "with", "from", "that", "this", "have", "robot"].includes(token));
}

function overlaps(proposal: string, constraint: string): boolean {
  const proposalNorm = normalize(proposal);
  const constraintNorm = normalize(constraint);
  if (!proposalNorm || !constraintNorm) return false;
  if (proposalNorm.includes(constraintNorm.slice(0, Math.min(48, constraintNorm.length)))) return true;
  const tokens = significantTokens(constraint);
  if (!tokens.length) return false;
  const hits = tokens.filter((token) => proposalNorm.includes(token));
  return hits.length >= Math.min(2, tokens.length);
}

function severityForConstraint(constraint: string): ComplianceSeverity {
  if (/\b(must not|may not|cannot|shall not|prohibited|illegal)\b/i.test(constraint)) return "block";
  if (HARD_CONSTRAINT_RE.test(constraint)) return "warn";
  return "info";
}

export function checkGameRuleCompliance(input: {
  proposal: string;
  constraints?: string[];
  ruleNotes?: RuleNoteLite[];
}): ComplianceReport {
  const proposal = (input.proposal ?? "").trim();
  const findings: ComplianceFinding[] = [];

  if (!proposal) {
    return {
      status: "warn",
      findings: [
        {
          severity: "warn",
          ruleRef: "",
          message: "No design proposal text was provided to check.",
          matchedConstraint: "",
        },
      ],
      adviceLabel: "MODEL",
      disclaimer: DISCLAIMER,
    };
  }

  for (const constraint of input.constraints ?? []) {
    const text = String(constraint ?? "").trim();
    if (!text || !overlaps(proposal, text)) continue;
    const severity = severityForConstraint(text);
    findings.push({
      severity,
      ruleRef: "",
      message:
        severity === "block"
          ? "Proposal language conflicts with a hard stored constraint — confirm before freezing CAD envelopes."
          : "Proposal may touch a stored constraint — verify dimensions / legality before committing geometry.",
      matchedConstraint: text.slice(0, 400),
    });
  }

  const proposalDims = [...proposal.matchAll(DIMENSION_RE)].map((match) => match[0]!);
  if (proposalDims.length) {
    for (const constraint of input.constraints ?? []) {
      const constraintDims = [...String(constraint).matchAll(DIMENSION_RE)].map((match) => match[0]!);
      if (!constraintDims.length || findings.some((f) => f.matchedConstraint === constraint)) continue;
      findings.push({
        severity: "warn",
        ruleRef: "",
        message: `Proposal cites ${proposalDims.slice(0, 3).join(", ")} while a stored constraint cites ${constraintDims.slice(0, 3).join(", ")} — confirm they agree.`,
        matchedConstraint: String(constraint).slice(0, 400),
      });
    }
  }

  for (const note of input.ruleNotes ?? []) {
    if ((note.status ?? "open") !== "open") continue;
    const question = String(note.question ?? "").trim();
    if (!question || !overlaps(proposal, question)) continue;
    findings.push({
      severity: "warn",
      ruleRef: String(note.ruleRef ?? "").trim(),
      message: `Open rules question may affect this design: ${question}`,
      matchedConstraint: question.slice(0, 400),
    });
  }

  const hasBlock = findings.some((f) => f.severity === "block");
  const hasWarn = findings.some((f) => f.severity === "warn");
  return {
    status: hasBlock ? "fail" : hasWarn ? "warn" : "pass",
    findings: findings.slice(0, 24),
    adviceLabel: "MODEL",
    disclaimer: DISCLAIMER,
  };
}
