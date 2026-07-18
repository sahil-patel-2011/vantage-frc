# Business portal legacy (archived)

The sibling checkout `Vantage FRC Robotics AIO APP-business-portal` was a **git worktree** of the
same `vantage-frc` repository on branch `codex/business-portal` at commit `447faf7`
("Add unified team business portal").

That commit is already an ancestor of `main` / `origin/main`. The live product surface is
`apps/web` `/business` (plus related `/team/sponsors`, `/team/grants`, `/team/budgets`,
`/team/finance`, partner placements APIs). No unique portal code was left to port; main had
already unified and extended the portal (including Soft-UI shell and partner placements).

The sibling worktree was removed during local folder consolidation. Prefer a single clone at:

`C:\Users\sahil\Cursor Projects\Vantage`

Do not stand up a second Vercel/Neon app for a separate business portal.

## Local folder rename (2026-07-17)

- Sibling `…-business-portal` worktree: removed (empty after unregister; no unique leftovers).
- Preferred path `C:\Users\sahil\Cursor Projects\Vantage`: created as a **directory junction** to the
  still-locked folder `Vantage FRC Robotics AIO APP` (Cursor/other agents held open handles).
- To finish a true rename later: close Cursor/agents on the old path, delete the junction
  (`rmdir "C:\Users\sahil\Cursor Projects\Vantage"` — does not delete target), then
  `Rename-Item` the old folder to `Vantage`.
