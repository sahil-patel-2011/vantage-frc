# Agent kit

Everything an AI engineering agent needs to work on Vantage on its own and safely.

| File | Use |
| --- | --- |
| [SYSTEM_PROMPT.md](SYSTEM_PROMPT.md) | Paste into the agent's system prompt / custom instructions. |
| [TASK_01_TEAM_JOINING.md](TASK_01_TEAM_JOINING.md) | First task: join requests that go through, a daily team code, and a 100-team load check. |
| `.claude/skills/vantage-workflow` | The loop: read, plan, change, prove, self-review, ship. |
| `.claude/skills/vantage-code-review` | How the code is structured; review checklists. |
| `.claude/skills/vantage-gui-testing` | Local stack, dev sign-in, browser walk-throughs, screenshots. |
| `.claude/skills/vantage-ui-design` | The UI rules every screen follows. |
| `.claude/skills/vantage-supabase` | Production Postgres: roles, pooler, RLS, migrations. |
| `.claude/skills/vantage-production-gotchas` | What differs from localhost, deploy gating, 100-team design. |
| `scripts/agent/ui-check.mjs` | Sign in locally, screenshot pages at phone/desktop, flag common UI problems. |

Claude Code loads the skills in `.claude/skills/` automatically when it works in this repo.
