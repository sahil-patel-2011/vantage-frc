---
name: frc-fundamentals
description: >-
  FRC (FIRST Robotics Competition) fundamentals: what FRC is, how a match and
  season work (alliances, autonomous/teleop/endgame, ranking, awards), the current
  game-year pack (2026 REBUILT is published; later years may be awaiting a manual),
  and how that maps to Vantage scouting, CAD, and robot code. Use when the user
  asks what FRC is, how matches work, what REBUILT or BIOCORE is, ranking or
  alliance selection, or how Vantage scouting/CAD/code relate to the game.
---

# FRC fundamentals (Cursor / Claude Code)

Orientation for agents helping with **direct FRC work** in this repo. This is not
a product-UI dump and not a substitute for FIRST's Game Manual.

Canonical structured copy lives in `packages/game-year` (`frcFundamentals()`).
The hosted Vantage agent exposes the same object as the `frc.fundamentals` tool.
Cursor picks this skill up the same way CAD skills live on disk
(`.agents/skills/cad-onshape`, `.agents/skills/cad-fusion`).

## Rules

- Summarize. **Do not copy** FIRST Game Manual, Team Update, or Q&A text.
- **Do not invent** point values, ranking-point formulas, robot size/weight limits,
  cycle times, or demo metrics. If a number is not in the game-year pack or an
  official page you fetched, say you do not have it and link the manual.
- When `packages/game-year` marks a year `awaiting_manual`, say the scoring table
  is not published yet. Use the last **published** pack only as prior-season study
  material — never as this year's rules.
- Ground detail in FIRST / WPILib URLs below (or `web.fetch` on those hosts).

## What FRC is

FIRST Robotics Competition is FIRST's high-school robotics program. Student teams
design, build, and program a robot for a **new game each season**, then compete
at events. Mentors coach; students do the work.

Source: https://www.firstinspires.org/robotics/frc

## How a match works

- Two **alliances of three robots** (red vs blue).
- **Autonomous** first: pre-programmed; the drive team does not drive.
- **Teleop** next: drivers control the robot for most of the match.
- **Endgame** is the closing window of teleop. Typical tasks are climb, park, or
  another year-specific action — only that year's manual names and scores them.
- Period lengths and points are **only** in the Game Manual + Team Updates + Q&A.

Sources:

- https://www.firstinspires.org/resource-library/frc/competition-manual-qa-system
- https://www.firstinspires.org/robotics/frc/playing-field

## How a season works

Kickoff in January reveals the game. Teams have a short build window, then play
**district or regional** events and may advance toward a championship. FIRST sets
the real calendar each year — confirm dates on firstinspires.org.

Sources:

- https://www.firstinspires.org/robotics/frc/kickoff
- https://www.firstinspires.org/robotics/frc/team-management-resources

## Ranking and playoffs (high level)

Qualification matches seed the ranking. Ranking uses ranking points and
**published tiebreakers for that year** — do not invent RP values. After quals,
alliance captains pick partners for playoffs. Playoffs decide the event winner;
judged awards are separate.

Source: the Game Manual & Q&A link above.

## Awards (high level)

FIRST publishes judged team awards (culture/impact, engineering inspiration,
design and control) and individual honors (student Dean's List, mentor Woodie
Flowers). Names and submission rules change by season.

Source: https://www.firstinspires.org/robotics/frc/awards

## Current game year in this repo

Read `packages/game-year` — do not guess a game name.

| Year | Pack | Status | What you may say |
|------|------|--------|------------------|
| 2026 | **REBUILT** | `published` | Fuel (auto, teleop, passed), tower climb none/L1/L2/L3, trench and bump as traversal facts. Pit: drivetrain, motors, language, driver seasons, photos, clearance. No claimed scoring in the pit. |
| 2027 | BIOCORE | `awaiting_manual` | Kickoff Jan 9, 2027. **No scoring keys.** Study 2026 REBUILT until FIRST publishes the 2027 manual. |

August (calendar) starts next-season planning in `currentSeasonYear()`. If today
is after that rollover, treat BIOCORE as the planning year and REBUILT as the
last published pack.

Hosted tool: `frc.fundamentals` with optional `seasonYear` (locked to the org
active event when omitted).

## Map to Vantage

| Area | Where | Agent notes |
|------|--------|-------------|
| **Scouting** | `/scouting`, `/scouting/forms` | Forms follow the game-year pack. Use `scouting.team` / `scouting.schema` for org rows. Empty when there are no scout rows — never invent observations. |
| **CAD** | `/build?tab=cad`, `/cad-vault` | Drive Onshape/Fusion via **vantage-cad MCP** and `.agents/skills/cad-onshape` / `cad-fusion`. Propose; do not push without an explicit confirm. Not certified engineering. |
| **Code** | `/build?tab=code`, `/dev-setup` | Ground robot APIs in WPILib: https://docs.wpilib.org/en/stable/ and Zero-to-Robot https://docs.wpilib.org/en/stable/docs/zero-to-robot/introduction.html |

Season workflow in-app: `docs/SEASON_WORKFLOW.md`. CAD from the terminal: `docs/CLAUDE_CODE_CAD.md`.

## Official links (fetch these, do not paraphrase PDFs into rules)

- https://www.firstinspires.org/robotics/frc
- https://www.firstinspires.org/resource-library/frc/competition-manual-qa-system
- https://www.firstinspires.org/robotics/frc/kickoff
- https://www.firstinspires.org/robotics/frc/playing-field
- https://www.firstinspires.org/robotics/frc/awards
- https://www.firstinspires.org/robotics/frc/team-management-resources
- https://docs.wpilib.org/en/stable/
- https://docs.wpilib.org/en/stable/docs/zero-to-robot/introduction.html
