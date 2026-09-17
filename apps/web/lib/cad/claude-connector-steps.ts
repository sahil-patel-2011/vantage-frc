/**
 * Setting up the Claude Code CAD connector, in the order it actually works.
 *
 * The steps live here rather than in the component so the copy can be tested
 * and so the shell commands exist exactly once. Two things about this setup
 * catch everyone out, and both are called out on the step that causes them:
 *
 * Claude Code reads a server's tool list when it connects, so a session that
 * was already open will not see the tools no matter how many times you retry.
 * You have to start a new one.
 *
 * And "does it need to stay running" has two different answers. The MCP server
 * is launched by Claude Code itself and stops with it — there is nothing to
 * leave open. The Fusion bridge is a long-running process and does have to stay
 * in its terminal. Saying "the connector stays running" without that
 * distinction is how people end up leaving a window open forever for Onshape
 * work that never needed it, or closing the one Fusion did.
 */

export type ConnectorStep = {
  id: string;
  title: string;
  /** What this step is for, in one or two sentences. */
  body: string;
  /** The exact command, if the step is a command. */
  command?: string;
  /** A thing that trips people up, shown apart from the body. */
  gotcha?: string;
};

export const CONNECTOR_STEPS: readonly ConnectorStep[] = [
  {
    id: "login",
    title: "Sign in to Onshape",
    body: "A real browser window opens and you sign in yourself — password, SSO, 2FA, whatever your school uses. Nothing is typed for you, and the session is saved only on this computer.",
    command: "npx vantage-cad login",
    gotcha:
      "A signed-in browser session is the path Onshape does not charge against your team's annual API allowance. API keys and OAuth are charged.",
  },
  {
    id: "pair",
    title: "Pair this computer with your team",
    body: "Links this machine to your Vantage workspace, so CAD work you do from the terminal shows up on the team's CAD page alongside everyone else's.",
    command: "npx vantage-cad setup",
  },
  {
    id: "register",
    title: "Tell Claude Code about the tools",
    body: "Registers the connector as an MCP server. From this repository you can skip it: a .mcp.json checked in at the root already says the same thing.",
    command: "claude mcp add vantage-cad -- npx vantage-cad mcp",
  },
  {
    id: "restart",
    title: "Start a new Claude Code session",
    body: "Claude Code reads a server's tool list once, when it connects. A session that was already open will not pick the tools up.",
    gotcha:
      "This is the step people skip. If the CAD tools are missing, start a new session before you try anything else — retrying a tool call cannot fix it.",
  },
  {
    id: "check",
    title: "Check it before you need it",
    body: "Prints a pass or fail for every part of the setup. Worth running once on a quiet evening rather than the night before a deadline.",
    command: "npx vantage-cad doctor",
  },
];

/**
 * What has to stay open, and what does not.
 *
 * Kept separate from the steps because it is the question people ask after
 * they finish, and because the answer depends on which CAD tool they use.
 */
export const CONNECTOR_LIFECYCLE = {
  onshape: {
    title: "Onshape: nothing to leave running",
    body: "Claude Code starts the connector itself when a session opens and stops it when the session ends. There is no window to keep open and nothing living in your system tray.",
  },
  fusion: {
    title: "Fusion: one terminal stays open",
    body: "Fusion work goes through a bridge that runs on your computer, because Fusion has no web API. Start it with npx vantage-cad start and leave that terminal open for as long as you are working. Close it and Fusion jobs stop; Onshape work carries on regardless.",
    command: "npx vantage-cad start",
  },
} as const;

/** Said plainly and early, because it is the thing that would cost real work. */
export const CONNECTOR_SAFETY =
  "Point your first run at a scratch document, never at the competition robot. Shape changes wait for a person to approve them, but a first run is still a first run.";
