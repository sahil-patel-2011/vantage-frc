export const AI_BRIDGE_TITLE = "Personal Codex";
export const AI_BRIDGE_CRUMB = "Team / Personal Codex";
export const AI_BRIDGE_FEATURE_LABEL = "Personal Codex";

export const AI_BRIDGE_SETUP_STEPS = [
  "Install Codex on your own computer. Each person connects their own account, including on shared computers.",
  "On that computer, download the Vantage connector and start it with the commands below. It needs Node.js 20 or newer and shows an 8-character code.",
  "Approve your code here, then sign in and test with the commands below. Leave the connector running for your Vantage requests.",
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
        description: "Choose your team to use its context with your personal Codex connection.",
      };
    case "setup":
      return {
        badge: "Needs setup",
        title: "Connect your Codex",
        description:
          "Pair your computer, sign in to your own Codex profile, and test the connection.",
      };
    case "ready":
      return {
        badge: "Connected",
        title: "Personal Codex",
        description: "Your connected computer answers your requests while online. Revoke it here to stop.",
      };
    default: {
      const _exhaustive: never = kind;
      return _exhaustive;
    }
  }
}
