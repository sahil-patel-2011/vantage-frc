/**
 * The programming onboarding track: laptop → toolchain → git → AI tools → first change.
 *
 * Why this exists as data rather than a docs page: a new programmer needs to know
 * three different things about every tool, and prose blurs them together —
 *   what it is, HOW to install it, and WHEN you actually reach for it.
 * The third one is what guides skip and what a 9th-grader in week one needs most.
 * So every step carries `why` (when you use it) separately from `install`.
 *
 * EVERY URL HERE WAS VERIFIED TO RETURN 200 before being committed. One
 * plausible-looking WPILib PathPlanner docs URL 404'd during that check and was
 * replaced with pathplanner.dev. Do not add a link from memory — check it first.
 * A dead link in a setup guide costs a student their whole first session.
 */

export type Os = "mac" | "windows";

export const OS_LABELS: Record<Os, string> = {
  mac: "macOS",
  windows: "Windows",
};

/** localStorage key for laptop/programming setup ticks. Shared with Home. */
export const DEV_SETUP_DONE_KEY = "vantage-dev-setup-done";
export const DEV_SETUP_OS_KEY = "vantage-dev-setup-os";

export type StepLink = {
  label: string;
  href: string;
  /** True when this is the actual download, not background reading. */
  download?: boolean;
};

export type Step = {
  id: string;
  title: string;
  /** When you actually reach for this — the part most guides leave out. */
  why: string;
  /** Which platforms this step applies to. */
  os: Os[] | "all";
  /** Concrete instructions, one line per action. */
  install: string[];
  /** Shell commands, shown in a copyable block. */
  commands?: { mac?: string[]; windows?: string[]; all?: string[] };
  /**
   * Alternative ways to do the same step, each its own tab on the code block.
   * This is the shape the Claude Code docs use (Native install / Homebrew /
   * WinGet) and it matters here because "install gh" genuinely has two right
   * answers depending on the machine, and showing both at once is confusing
   * while showing only one leaves half the team stuck.
   */
  methods?: Array<{
    label: string;
    /** Restrict this tab to one platform; omit to show on both. */
    os?: Os;
    lines: string[];
    note?: string;
  }>;
  /** How to know it actually worked. Every step needs one. */
  verify: string;
  links: StepLink[];
  /** Roughly how long, so a lead can plan a session. */
  minutes: number;
  /** Rendered as a highlighted aside — the thing people wish they had known. */
  tip?: string;
  /** Rendered as a warning — the thing that is painful to undo. */
  warning?: string;
};

export type Stage = {
  id: string;
  title: string;
  blurb: string;
  steps: Step[];
};

export const TRACK: Stage[] = [
  {
    id: "laptop",
    title: "1 · Your laptop",
    blurb:
      "The three tools every programmer on the team needs, whatever subteam you end up on. Do these before build season starts — not on kickoff morning.",
    steps: [
      {
        id: "homebrew",
        title: "Homebrew (macOS only)",
        why:
          "A package manager: one command installs a tool and everything it depends on, instead of hunting for installers. On Windows you do not need this — winget ships with the OS and does the same job.",
        os: ["mac"],
        install: [
          "Open Terminal (Cmd+Space, type Terminal).",
          "Paste the command below and press Enter.",
          "It will ask for your laptop password. Typing shows nothing — that is normal, just type it and press Enter.",
          "At the end it prints two extra commands under 'Next steps'. Run those too, or brew will not be found in new terminals.",
        ],
        commands: {
          mac: [
            '/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"',
          ],
        },
        verify: "Run `brew --version`. You should see a version number, not 'command not found'.",
        links: [{ label: "brew.sh", href: "https://brew.sh", download: true }],
        minutes: 10,
      },
      {
        id: "git",
        title: "Git",
        why:
          "Git is the history of your code. It is what lets four people edit the robot code the same night without overwriting each other, and what lets you get back to yesterday's working version at 11pm before a competition. You will use it every single session.",
        os: "all",
        install: [
          "macOS: install with Homebrew (below), or it may already be there.",
          "Windows: download the installer and accept every default EXCEPT the editor — pick VS Code if offered.",
          "Set your name and email so your commits are attributed to you.",
        ],
        commands: {
          mac: ["brew install git"],
          all: [
            'git config --global user.name "Your Name"',
            'git config --global user.email "you@example.com"',
          ],
        },
        verify: "Run `git --version`, then `git config --global user.name` and check it prints your name.",
        links: [{ label: "git-scm.com/downloads", href: "https://git-scm.com/downloads", download: true }],
        minutes: 10,
      },
      {
        id: "vscode",
        title: "Visual Studio Code",
        why:
          "The editor you write robot code in. WPILib installs its own copy of VS Code with the FRC extensions already in it — but installing VS Code yourself first is still worth it, because you will use it for everything else too.",
        os: "all",
        install: [
          "Download and install for your platform.",
          "Open it once so it finishes first-run setup.",
        ],
        verify: "VS Code opens and you can create and save a file.",
        links: [
          { label: "code.visualstudio.com/download", href: "https://code.visualstudio.com/download", download: true },
          { label: "VS Code basics", href: "https://code.visualstudio.com/docs/getstarted/getting-started" },
        ],
        minutes: 10,
      },
    ],
  },
  {
    id: "frc",
    title: "2 · The FRC toolchain",
    blurb:
      "WPILib is the big one — it brings the robot libraries, its own VS Code, and the build system. Install it in this order; the Game Tools need a restart and people lose an hour skipping that.",
    steps: [
      {
        id: "wpilib",
        title: "WPILib",
        why:
          "The robot code framework and everything that compiles and deploys it. This is the tool you are actually in when you write robot code. It installs a SEPARATE copy of VS Code called '2026 WPILib VS Code' — use that one for robot code, not your normal VS Code, because only it has the deploy commands.",
        os: "all",
        install: [
          "Download the release for your platform from the GitHub releases page.",
          "Open the downloaded disk image or archive and run the installer.",
          "Choose 'Everything' when asked what to install.",
          "When it offers to download VS Code, say yes — that is the copy you will use.",
          "Installation takes a while and needs several GB of disk. Start it before you need it.",
        ],
        verify:
          "You have a '2026 WPILib VS Code' application. Open it, press Ctrl+Shift+P (Cmd+Shift+P on Mac), type 'WPILib' — you should see WPILib commands.",
        links: [
          { label: "WPILib releases (download)", href: "https://github.com/wpilibsuite/allwpilib/releases", download: true },
          { label: "Official install walkthrough", href: "https://docs.wpilib.org/en/stable/docs/zero-to-robot/step-2/wpilib-setup.html" },
          { label: "Zero-to-Robot: start here", href: "https://docs.wpilib.org/en/stable/docs/zero-to-robot/introduction.html" },
        ],
        minutes: 45,
      },
      {
        id: "game-tools",
        title: "FRC Game Tools (Windows only)",
        why:
          "The Driver Station and roboRIO Imaging Tool. You need this to actually drive the robot and to flash the roboRIO. It is Windows-only — this is why every team keeps at least one Windows laptop at competition even if everyone codes on a Mac.",
        os: ["windows"],
        install: [
          "Download from NI. You have to create a free NI account.",
          "Run the installer, then RESTART. It does not work properly until you do.",
        ],
        verify: "FRC Driver Station opens and shows the team number field.",
        links: [
          { label: "NI FRC Game Tools (download)", href: "https://www.ni.com/en/support/downloads/drivers/download.frc-game-tools.html", download: true },
        ],
        minutes: 40,
      },
      {
        id: "vendor-tools",
        title: "Motor controller tools",
        why:
          "Install the one your team's hardware uses — REV for SPARK MAX/Flex, CTRE for Talon/Kraken. You use these to set CAN IDs and update firmware. If a motor is not responding, this is where you look before you touch the code. Ask your electrical lead which you need.",
        os: "all",
        install: [
          "REV Hardware Client if your robot uses SPARK MAX or SPARK Flex.",
          "CTRE Phoenix Tuner X if it uses Talon FX, Kraken, or CANcoder.",
          "Most teams need both. Installing both is harmless.",
        ],
        verify: "The client opens and can see devices when a roboRIO is connected over USB.",
        links: [
          { label: "REV Hardware Client", href: "https://docs.revrobotics.com/rev-hardware-client/", download: true },
          { label: "CTRE Phoenix Tuner X", href: "https://pro.docs.ctr-electronics.com/en/latest/docs/tuner/index.html", download: true },
        ],
        minutes: 20,
      },
    ],
  },
  {
    id: "autonomous",
    title: "3 · Paths and telemetry",
    blurb:
      "You do not need these on day one. Install them when you start working on autonomous or when something is behaving strangely and you need to see what the robot actually did.",
    steps: [
      {
        id: "pathplanner",
        title: "PathPlanner",
        why:
          "Draw autonomous paths on a picture of the field instead of guessing at numbers. Reach for it the first time someone says 'the auto drifts to the left' — you tune the path visually rather than editing coordinates by hand.",
        os: "all",
        install: [
          "Download the release for your platform.",
          "Open your robot project's folder in PathPlanner — it saves paths into the project so they get committed with the code.",
        ],
        verify: "You can open your robot project in PathPlanner and see the field view.",
        links: [
          { label: "PathPlanner releases (download)", href: "https://github.com/mjansen4857/pathplanner/releases", download: true },
          { label: "PathPlanner docs", href: "https://pathplanner.dev" },
        ],
        minutes: 20,
      },
      {
        id: "advantagescope",
        title: "AdvantageScope",
        why:
          "Replays what the robot actually did — every sensor value, over time. This is the tool that answers 'why did it do that?' after a match. Use it when a problem only happens sometimes, because you cannot catch those by watching.",
        os: "all",
        install: ["Download the release for your platform and install it.", "Open a log file from the roboRIO or a live connection."],
        verify: "AdvantageScope opens and you can load a log or connect to a running robot.",
        links: [
          { label: "AdvantageScope releases (download)", href: "https://github.com/Mechanical-Advantage/AdvantageScope/releases", download: true },
        ],
        minutes: 15,
      },
      {
        id: "dashboard",
        title: "A driver dashboard",
        why:
          "What the drive team looks at during a match — battery, camera, auto chooser. Shuffleboard already comes with WPILib; Elastic is a popular lighter alternative. Set this up with your drive team, not alone, because they decide what needs to be on it.",
        os: "all",
        install: [
          "Shuffleboard is already installed with WPILib — nothing to do.",
          "Or download Elastic if your team prefers it.",
        ],
        verify: "The dashboard connects to the robot or simulator and shows values.",
        links: [{ label: "Elastic dashboard releases", href: "https://github.com/Gold872/elastic-dashboard/releases", download: true }],
        minutes: 15,
      },
    ],
  },
  {
    id: "github-account",
    title: "4 · Your GitHub account",
    blurb:
      "Do this in this exact order. The order matters more than it looks: which email you sign up with decides whether you still own this account after you graduate.",
    steps: [
      {
        id: "gh-signup",
        title: "Sign up with your PERSONAL email",
        why:
          "Your GitHub account is your portfolio — colleges and employers look at it, and it should outlive high school. Sign up with a personal email you will keep. Your school email gets switched off after graduation, and people who signed up with it lose the account and everything in it.",
        os: "all",
        install: [
          "Go to github.com and create an account.",
          "Use a PERSONAL email address — Gmail, Outlook, whatever you will still have in five years.",
          "Pick a username you would be comfortable putting on a college application. It is public and changing it later breaks links.",
          "Verify the email GitHub sends you.",
        ],
        verify: "You can sign in at github.com and see your profile.",
        tip:
          "Username advice nobody gives you: use something close to your real name. `sarah-chen-dev` reads well on an application; `xXfrcgamerXx` does not, and you cannot quietly change it once people link to your work.",
        warning:
          "Do NOT sign up with your school email. It becomes your login, and when the district disables the account you lose access to GitHub too.",
        links: [
          { label: "github.com", href: "https://github.com", download: true },
          { label: "GitHub: creating an account", href: "https://docs.github.com/en/get-started/start-your-journey/creating-an-account-on-github" },
        ],
        minutes: 10,
      },
      {
        id: "gh-school-email",
        title: "Add your school email as a second address",
        why:
          "This is what proves you are a student, without making your school email the account itself. GitHub lets one account hold several verified emails — the personal one stays your login, the school one unlocks the Student Developer Pack.",
        os: "all",
        install: [
          "Go to Settings → Emails (link below).",
          "Under 'Add email address', enter your school email and add it.",
          "Open your school inbox and click GitHub's verification link.",
          "Leave your personal email as the primary. Do not switch it.",
        ],
        verify: "Settings → Emails lists BOTH addresses, and the school one shows as verified.",
        tip:
          "If your school blocks outside mail, the verification email is usually in quarantine or junk. Check there before assuming it did not send.",
        links: [
          { label: "GitHub → Settings → Emails", href: "https://github.com/settings/emails", download: true },
          { label: "GitHub: adding an email address", href: "https://docs.github.com/en/account-and-profile/setting-up-and-managing-your-personal-account-on-github/managing-email-preferences/adding-an-email-address-to-your-github-account" },
        ],
        minutes: 10,
      },
      {
        id: "gh-student-pack",
        title: "Apply for the Student Developer Pack",
        why:
          "It is free and it gives students what GitHub otherwise charges for — the Pro features, plus free credit on a pile of developer tools. There is no reason for a student on this team not to have it. The application is mostly about photographing one piece of paper properly.",
        os: "all",
        install: [
          "Print or export your CURRENT academic transcript, or a grade report that shows this term.",
          "Get your student ID card.",
          "Photograph them TOGETHER in one image: ID card laid on top of the transcript, nothing covering text.",
          "Check the photo before submitting — your full name, the school name, and the current date or term must all be readable when you zoom in. Blurry text is the number one rejection reason.",
          "Go to education.github.com/pack and start the application.",
          "Use your SCHOOL email as the academic address and upload the photo.",
          "Submit. If it comes back with a problem, fix exactly what it names and resubmit — a rejection is not a ban.",
        ],
        verify:
          "Your application shows as submitted, and later your GitHub billing page shows the Student benefits applied.",
        tip:
          "Take the photo in daylight, flat on a table, phone directly above — not at an angle. A tilted photo makes the text warp and reviewers cannot read it. If your name on the ID does not exactly match your GitHub profile name, set your profile name to match first; a mismatch gets rejected.",
        warning:
          "GitHub usually reviews the application within about 15 minutes, and the benefits land on your account within about 72 hours. So a quick approval followed by nothing changing for a day or two is normal and does not mean it failed. Do not submit again while you are waiting — duplicates slow it down.",
        links: [
          { label: "Apply: education.github.com/pack", href: "https://education.github.com/pack", download: true },
          { label: "GitHub: how to apply as a student", href: "https://docs.github.com/en/education/about-github-education/github-education-for-students/apply-to-github-education-as-a-student" },
          { label: "What you get", href: "https://docs.github.com/en/education/about-github-education/github-education-for-students/about-github-education-for-students" },
        ],
        minutes: 30,
      },
      {
        id: "gh-cli-auth",
        title: "Sign in to GitHub from your terminal",
        why:
          "Once you sign in this way, git stops asking for a password every time you push, and you never paste a token into a file. Do this once per laptop. GitHub has not accepted account passwords for git operations for years, which is why 'it keeps rejecting my password' is the most common first-week problem.",
        os: "all",
        install: [
          "Install the GitHub CLI (`gh`) using the command for your platform below.",
          "Run `gh auth login`.",
          "Answer: GitHub.com → HTTPS → yes, authenticate git → Login with a web browser.",
          "It shows a one-time code. Copy it, press Enter, paste the code in the browser it opens, and approve.",
          "Come back to the terminal — it will say you are logged in.",
        ],
        methods: [
          {
            label: "Homebrew",
            os: "mac",
            lines: ["brew install gh", "gh auth login", "gh auth status"],
            note: "The usual way on a Mac. If brew is missing, do the Homebrew step at the top of this guide first.",
          },
          {
            label: "Direct download",
            os: "mac",
            lines: ["gh auth login", "gh auth status"],
            note: "If you would rather not use Homebrew, download the .pkg from cli.github.com, install it, then run these two.",
          },
          {
            label: "WinGet",
            os: "windows",
            lines: ["winget install --id GitHub.cli", "gh auth login", "gh auth status"],
            note: "winget ships with Windows 11. If it is not recognised, use the Direct download tab instead.",
          },
          {
            label: "Direct download",
            os: "windows",
            lines: ["gh auth login", "gh auth status"],
            note: "Download the .msi installer from cli.github.com, run it, then CLOSE and reopen your terminal before running these — PATH only updates in new windows.",
          },
        ],
        verify:
          "`gh auth status` prints your username and 'Logged in to github.com'. After this, `git push` works without asking for a password.",
        tip:
          "On Windows, if `gh` is not recognised straight after installing, close the terminal and open a new one — the PATH only updates for new windows.",
        links: [
          { label: "GitHub CLI", href: "https://cli.github.com", download: true },
          { label: "gh auth login reference", href: "https://cli.github.com/manual/gh_auth_login" },
          { label: "GitHub: about authentication", href: "https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/about-authentication-to-github" },
        ],
        minutes: 15,
      },
    ],
  },
  {
    id: "git",
    title: "5 · Git: what push and pull mean",
    blurb:
      "This is the part people skip and then regret. You do not need to understand all of git — you need four commands and one mental model.",
    steps: [
      {
        id: "git-model",
        title: "What push and pull actually mean",
        why:
          "Almost every git mistake comes from not having this picture. There are two copies of the code: the one on your laptop and the one on GitHub. They do not sync automatically — nothing you do on your laptop reaches anyone else until you push, and nothing anyone else does reaches you until you pull.",
        os: "all",
        install: [
          "clone — make your own copy of the team's code on your laptop. You do this once.",
          "pull — bring down everyone else's changes. Do this EVERY time you sit down, before you write anything.",
          "commit — save a checkpoint on your laptop, with a message saying what you changed. Nobody else sees this yet.",
          "push — send your commits to GitHub so the rest of the team gets them.",
          "The single most common mistake: writing code for two hours without pulling first, then discovering someone changed the same file. Pull first. Every time.",
        ],
        commands: {
          all: [
            "git clone <the team's repo URL>",
            "git pull",
            "git add -A",
            'git commit -m "Fix intake not stopping at the sensor"',
            "git push",
          ],
        },
        verify:
          "You can explain to someone else why a change on your laptop is not on GitHub until you push. If you cannot, read the linked page before moving on.",
        links: [
          { label: "GitHub: about Git", href: "https://docs.github.com/en/get-started/using-git/about-git" },
          { label: "Learn Git Branching (visual, interactive)", href: "https://learngitbranching.js.org" },
        ],
        minutes: 30,
      },
      {
        id: "branches-prs",
        title: "Branches and pull requests",
        why:
          "A branch is your own workspace where you can break things without breaking the robot code everyone else is using. A pull request is how you ask for your work to be reviewed and merged. During build season this is what stops one person's half-finished change from bricking the robot the night before a competition.",
        os: "all",
        install: [
          "Make a branch named after what you are doing.",
          "Commit and push to that branch.",
          "Open a pull request on GitHub and ask a lead or mentor to look at it.",
          "Never push straight to main during build season unless your team has agreed to that.",
        ],
        commands: {
          all: ["git checkout -b intake-sensor-fix", "git push -u origin intake-sensor-fix"],
        },
        verify: "You have opened one pull request and had someone comment on it.",
        links: [
          {
            label: "GitHub: about pull requests",
            href: "https://docs.github.com/en/pull-requests/collaborating-with-pull-requests/proposing-changes-to-your-work-with-pull-requests/about-pull-requests",
          },
          { label: "GitHub Desktop (if you prefer buttons to commands)", href: "https://desktop.github.com", download: true },
        ],
        minutes: 30,
      },
    ],
  },
  {
    id: "ai",
    title: "6 · Working with AI tools",
    blurb:
      "Claude Code and Cursor make you faster, and they also make it very easy to commit code you do not understand. Both of those are true. Here is how to get the first without the second.",
    steps: [
      {
        id: "ai-setup",
        title: "Set up Claude Code or Cursor",
        why:
          "Cursor is an editor with AI built in — closest to what you already know. Claude Code runs in the terminal and is better at multi-file work. Pick one to start; you do not need both.",
        os: "all",
        install: [
          "Cursor: download, sign in, open your robot project folder.",
          "Claude Code: install and run it from inside your project directory.",
          "Point it at your ROBOT PROJECT folder, so it can see your actual code.",
        ],
        verify: "You can ask it a question about a file in your project and get an answer about YOUR code, not generic code.",
        links: [
          { label: "Claude Code", href: "https://claude.com/claude-code", download: true },
          { label: "Claude Code docs", href: "https://docs.anthropic.com/en/docs/claude-code/overview" },
          { label: "Cursor", href: "https://cursor.com", download: true },
        ],
        minutes: 20,
      },
      {
        id: "ai-effective",
        title: "Using it well",
        why:
          "The difference between a student who gets faster with AI and one who gets stuck is entirely about how they ask and what they check. These are the habits that separate them.",
        os: "all",
        install: [
          "Ask about a real symptom, not an abstraction: 'the intake keeps running after the sensor trips, here is IntakeSubsystem.java' beats 'write me an intake subsystem'.",
          "Give it the error text. Paste the whole stack trace, not your summary of it.",
          "Ask it to explain before you ask it to change: 'what does this command group actually do?' You are here to learn this, not to outsource it.",
          "Make it show you where. 'Which file and line?' — then go read that line yourself.",
          "When it writes code, ask 'what would break if this is wrong on the field?' It will often tell you something you had not considered.",
          "If you cannot explain the change to a mentor, do not commit it. That is the whole rule.",
        ],
        verify: "You have used it to fix one real bug AND you can explain the fix without looking at the chat.",
        links: [{ label: "Claude Code docs", href: "https://docs.anthropic.com/en/docs/claude-code/overview" }],
        minutes: 30,
      },
      {
        id: "ai-verify",
        title: "Checking what it gave you",
        why:
          "AI code compiles and looks right far more often than it IS right. On a robot, wrong code is not a red squiggle — it is a mechanism driving into a hard stop with a student standing next to it. Never let generated code reach the robot unchecked.",
        os: "all",
        install: [
          "Build it first. In WPILib VS Code: Ctrl+Shift+P → 'WPILib: Build Robot Code'. Compiling is the lowest bar, not proof.",
          "Simulate before you deploy: 'WPILib: Simulate Robot Code'. Catches the mistakes that would otherwise be found by the robot.",
          "Check every number it invented. Made-up CAN IDs, port numbers, gear ratios and gain numbers are the most common AI error in robot code, and they all compile fine.",
          "Deploy with the robot on blocks, wheels off the ground, and someone on the disable button.",
          "Read the diff before you commit: `git diff`. If it changed a file you did not expect, find out why.",
        ],
        verify: "You have built, simulated, and read the diff of an AI-assisted change before deploying it.",
        links: [
          { label: "WPILib in VS Code", href: "https://docs.wpilib.org/en/stable/docs/software/vscode-overview/index.html" },
          { label: "Zero-to-Robot: deploying", href: "https://docs.wpilib.org/en/stable/docs/zero-to-robot/step-4/index.html" },
        ],
        minutes: 25,
      },
    ],
  },
  {
    id: "first-change",
    title: "7 · Your first real change",
    blurb: "Everything above is setup. This is the part that makes you a programmer on this team.",
    steps: [
      {
        id: "first-pr",
        title: "Ship one small change end to end",
        why:
          "Doing the whole loop once — pull, branch, change, build, simulate, commit, push, review, merge — is what turns the steps above into something you actually own. Pick something genuinely small. A better log message counts.",
        os: "all",
        install: [
          "Ask a lead for a small, real task. Say it is your first one.",
          "Pull, branch, make the change.",
          "Build and simulate it.",
          "Commit with a message that says WHY, not what: 'Stop intake at sensor so notes do not jam' beats 'update IntakeSubsystem'.",
          "Push, open a pull request, ask for review.",
          "Fix what review finds. That part is normal and is not criticism.",
        ],
        verify: "Your pull request is merged and the change is on the robot.",
        links: [],
        minutes: 60,
      },
    ],
  },
];

/**
 * The commands worth coming back for, without re-reading the guide.
 *
 * This is the "I know what I need, just show me the line" surface. Everything
 * here appears somewhere above in context; this is the version you scan at
 * 10pm when the build is broken.
 */
export const COMMAND_REFERENCE: Array<{
  group: string;
  rows: Array<{ command: string; does: string; os?: Os }>;
}> = [
  {
    group: "Every session",
    rows: [
      { command: "git pull", does: "Bring down everyone else's changes. Do this BEFORE you write anything." },
      { command: "git status", does: "What have I changed, and am I on the right branch?" },
      { command: "git diff", does: "Show me exactly what I changed, line by line. Read this before committing." },
      { command: "git add -A", does: "Stage all your changes for the next commit." },
      { command: 'git commit -m "why you changed it"', does: "Save a checkpoint on your laptop. Nobody else sees it yet." },
      { command: "git push", does: "Send your commits to GitHub so the team gets them." },
    ],
  },
  {
    group: "Branches",
    rows: [
      { command: "git checkout -b my-change", does: "Start a new branch to work on." },
      { command: "git checkout main", does: "Go back to the main branch." },
      { command: "git push -u origin my-change", does: "Push a new branch to GitHub for the first time." },
      { command: "git branch", does: "Which branches exist, and which am I on?" },
    ],
  },
  {
    group: "GitHub sign-in",
    rows: [
      { command: "gh auth login", does: "Sign in to GitHub from the terminal. Once per laptop." },
      { command: "gh auth status", does: "Am I signed in, and as who?" },
      { command: "git clone <repo url>", does: "Get your own copy of the team's code." },
    ],
  },
  {
    group: "Robot code",
    rows: [
      { command: "Ctrl+Shift+P → WPILib: Build Robot Code", does: "Compile. The lowest bar — it compiling is not proof it is right." },
      { command: "Ctrl+Shift+P → WPILib: Simulate Robot Code", does: "Run it without a robot. Do this before you deploy." },
      { command: "Ctrl+Shift+P → WPILib: Deploy Robot Code", does: "Send code to the roboRIO. Robot on blocks, hand on disable." },
    ],
  },
  {
    group: "When something is wrong",
    rows: [
      { command: "git stash", does: "Put your changes aside temporarily so you can pull or switch branches." },
      { command: "git stash pop", does: "Bring those changes back." },
      { command: "git log --oneline -10", does: "The last ten commits, one line each." },
      { command: "brew --version", does: "Check Homebrew is installed and on your PATH.", os: "mac" },
      { command: "git --version", does: "Check git is installed and on your PATH." },
    ],
  },
];

export function stepsForOs(stage: Stage, os: Os): Step[] {
  return stage.steps.filter((step) => step.os === "all" || step.os.includes(os));
}

export function allStepIds(os: Os): string[] {
  return TRACK.flatMap((stage) => stepsForOs(stage, os).map((step) => step.id));
}

export function totalMinutes(os: Os): number {
  return TRACK.reduce(
    (sum, stage) => sum + stepsForOs(stage, os).reduce((inner, step) => inner + step.minutes, 0),
    0,
  );
}

/** Every external link in the track, for the link-integrity test. */
export function allLinks(): StepLink[] {
  return TRACK.flatMap((stage) => stage.steps.flatMap((step) => step.links));
}
