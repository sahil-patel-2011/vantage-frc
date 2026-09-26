export const AI_BRIDGE_TITLE = "Claude Code";
export const AI_BRIDGE_CRUMB = "Team / Claude Code";
export const AI_BRIDGE_FEATURE_LABEL = "Claude Code";

export const AI_BRIDGE_SETUP_STEPS = [
  "On a computer that stays on, install Claude Code and sign in with the Claude plan you already pay for.",
  "On that computer, download the Vantage connector and start it with the commands below. It needs Node.js 20 or newer and shows an 8-character code.",
  "Type the code here and approve it. Chat then uses that computer — no API key.",
] as const;

export function aiBridgeShellCopy(kind: "no-team" | "setup" | "ready"): {
  badge: string;
  title: string;
  description: string;
} {
  switch (kind) {
    case "no-team":
      return {
        badge: "Needs setup",
        title: "Choose your team",
        description: "Choose your team before pairing Claude Code to it.",
      };
    case "setup":
      return {
        badge: "Needs setup",
        title: "Pair Claude Code",
        description:
          "A mentor runs Claude Code in the terminal on one computer and pastes the code here. Ask AI then runs through Claude Code.",
      };
    case "ready":
      return {
        badge: "Connected",
        title: "Claude Code",
        description: "This computer answers Ask AI while it is online. Revoke it here to stop.",
      };
    default: {
      const _exhaustive: never = kind;
      return _exhaustive;
    }
  }
}
