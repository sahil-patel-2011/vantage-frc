/** Copy for granted teams only — own-Pi + Freebuff Coder UI. Never shown without a grant. */

export const FREEBUFF_ACCOUNT_URL = "https://www.freebuff.com";
export const FREEBUFF_CODER_HINT = "Freebuff Coder UI";

export const FREEBUFF_PI_SETUP_HEADLINE = "Connect your own Pi for your own Freebuff session";

export const FREEBUFF_PI_SETUP_INTRO =
  "Selected teams can run every Vantage AI feature through Freebuff Coder UI (unlimited coding models: DeepSeek V4 Flash, GLM 5.3 Flash, and MiMo 2.5). Teams without this grant stay on their own API keys or the credits we included. The shared platform box is named frcvantagefreebuff relay; your own Pi is better if you want a dedicated session.";

export type FreebuffSetupStep = {
  id: string;
  title: string;
  detail: string;
  href?: string;
};

export const FREEBUFF_PI_SETUP_STEPS: FreebuffSetupStep[] = [
  {
    id: "account",
    title: "Create a free Freebuff account",
    detail:
      "Open Freebuff, sign up, and stay on the free Coder plan. You will sign into Coder UI with this account — Vantage never stores that password.",
    href: FREEBUFF_ACCOUNT_URL,
  },
  {
    id: "coder-ui",
    title: "Sign in on the Pi once — then shut the laptop",
    detail:
      "On the Pi itself run: npx --yes @codebuff/cli login. That writes ~/.config/manicode/credentials.json. The Pi talks to Freebuff from that file. Do not paste a Freebuff token into Vantage, and do not leave a process running on your laptop.",
  },
  {
    id: "own-pi",
    title: "Install the always-on Pi layer",
    detail:
      "On the Pi: clone vantage-frc, run bash scripts/pi/install-free-relay.sh, then bash scripts/pi/pi-status.sh. That starts the layer, sweep, and tunnel as boot services plus a cron keep-alive. Close Connect and power off the laptop — the Pi stays up. Send the generated FREE_RELAY_API_KEY to the platform owner.",
  },
  {
    id: "folders",
    title: "Each team gets its own coding folder",
    detail:
      "On any shared box (including frcvantagefreebuff relay), work lands in org-<your-workspace-id>/ only. Another team’s folder is never opened. Chat context is filtered the same way.",
  },
];

export const NORMAL_TEAM_AI_PATH =
  "Without a Free AI grant, this team uses its own API keys or the request credits included on the plan. Freebuff Coder UI is not opened for you.";
