# Vantage documentation

Start with the section that matches you. Each document says who it is for in its first lines.

## If you use Vantage with your team

| Document | What it answers |
|---|---|
| [WHAT_IS_VANTAGE.md](WHAT_IS_VANTAGE.md) | What Vantage is, who it is for, and how the app is organized — in plain language |
| [SEASON_WORKFLOW.md](SEASON_WORKFLOW.md) | The FRC season phase by phase, and where each job lives in the app |
| [FEATURE_MAP.md](FEATURE_MAP.md) | Every screen and route, with what it shows and what it needs (reference; tests read it) |
| [DESKTOP.md](DESKTOP.md) | The Windows and macOS desktop app: install, updates, what it adds |
| [PUSH_NOTIFICATIONS.md](PUSH_NOTIFICATIONS.md) | Notifications: what sends them and how to turn them on |
| [DATA_EXPORTS.md](DATA_EXPORTS.md) | What an export contains and the file formats |
| [SUBTEAM_COVERAGE.md](SUBTEAM_COVERAGE.md) | What each subteam (mechanical, electrical, programming, business…) gets |

## Connecting tools and your own hardware

| Document | What it answers |
|---|---|
| [SPREADSHEET_MIRROR.md](SPREADSHEET_MIRROR.md) | Google Sheets and Excel as two identical copies of team data — sync, pull, rate limits |
| [GITHUB_CONNECTION.md](GITHUB_CONNECTION.md) | Linking the robot-code repository for Bugbot, code help and calendar milestones |
| [CLAUDE_CODE_CAD.md](CLAUDE_CODE_CAD.md) | Driving Onshape or Fusion 360 from Claude Code (`npx vantage-cad`) |
| [CAD_RELAY.md](CAD_RELAY.md) | The Fusion 360 desktop relay: what runs on the laptop and why |
| [ASSEMBLY_MANUAL.md](ASSEMBLY_MANUAL.md) | Turning an Onshape assembly into a step-by-step build book |
| [STORAGE_NODE.md](STORAGE_NODE.md) | Keeping large files on a machine the team owns |
| [AI_COMPUTE.md](AI_COMPUTE.md) | Which model runs where, and why — including what we measured about Petals |
| [LOCAL_AI.md](LOCAL_AI.md) | Running every AI feature on a local or free model endpoint |
| [LOCAL_RELAY.md](LOCAL_RELAY.md) | How a hosted deployment reaches a model on your LAN (the relay contract) |
| [FREEBUFF.md](FREEBUFF.md) | The Raspberry Pi relay fleet, and what Vantage will not do with Freebuff's hosted product |
| [AI_BRIDGE.md](AI_BRIDGE.md) | Running the team's chats through a member's own Claude Code subscription |
| [AGENT_CONFIG.md](AGENT_CONFIG.md) | Agent configuration bundles |
| [DREAMING.md](DREAMING.md) | Overnight team memory ("dreams") — what it reads and never reads |
| [PERFORMANCE_EMAIL.md](PERFORMANCE_EMAIL.md) | The weekly team performance email |
| [LIVE_DATA.md](LIVE_DATA.md) | Where event data comes from and how the shared cache is refreshed |

## Running your own copy

| Document | What it answers |
|---|---|
| [SELF_HOSTING.md](SELF_HOSTING.md) | **Start here.** From fork to a working deployment on Vercel + Neon |
| [DEPLOYMENT.md](DEPLOYMENT.md) | The full runbook: every environment variable, connector, callback URL and cron |
| [GO_LIVE_CHECKLIST.md](GO_LIVE_CHECKLIST.md) | What to verify before real users sign in |
| [CUSTOM_DOMAIN.md](CUSTOM_DOMAIN.md) | Putting the app on your own domain |
| [SUPABASE_CUTOVER.md](SUPABASE_CUTOVER.md) | Running on a Supabase Postgres host instead of Neon |
| [RELEASING.md](RELEASING.md) | Cutting releases, including desktop builds |
| [../SECURITY_OPERATIONS.md](../SECURITY_OPERATIONS.md) | The security model, admin access, secrets and how to report a problem |
| [PRICING.md](PRICING.md) | The plan and credit model, and what is charged when billing is configured |
| [FINANCE_SECURITY.md](FINANCE_SECURITY.md) | How money-related data is protected |

## Contributing

| Document | What it answers |
|---|---|
| [../CONTRIBUTING.md](../CONTRIBUTING.md) | Setup, conventions, how to verify a change, what a pull request needs |
| [ARCHITECTURE.md](ARCHITECTURE.md) | How the system fits together: request path, tenancy, AI path, workers, offline |
| [PRODUCTS.md](PRODUCTS.md) | Vantage and Scouting: two products on two hosts, one deployment, one database, one sign-in |
| [ARCHITECTURE_DECISIONS.md](ARCHITECTURE_DECISIONS.md) | Decisions that changed the system's shape, and why (Excel as a synced copy, the Scouting address, Base44, Lovat) |
| [UI_DESIGN_RULES.md](UI_DESIGN_RULES.md) | The interface rules every screen follows |
| [../CLAUDE.md](../CLAUDE.md) | Operating guide for AI coding agents working in this repository |

## Status and research

| Document | What it answers |
|---|---|
| [STATUS.md](STATUS.md) | What is done, what is in progress, what only the owner can unblock |
| [PREDICTION_RESULTS.md](PREDICTION_RESULTS.md) | Measured match-prediction accuracy (honest: not yet a validated claim) |
| [COMPETITIVE_NOTES.md](COMPETITIVE_NOTES.md) | Other FRC tools, what teams like about them, and the mistakes Vantage avoids |
| [archive/](archive/README.md) | Historical plans, audits and research briefs. Kept for context; not maintained |
