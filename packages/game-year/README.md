# @vantage/game-year

One pack per FRC season: the game's name, its scoring keys, a starting match
and pit schema, and a student-readable brief.

```ts
import { packForYear, currentSeasonYear, isManualPublished } from "@vantage/game-year";

const pack = packForYear(currentSeasonYear());
```

## Packs are only as confident as the manual

A pack carries `status: "published" | "awaiting_manual"`, and the difference is
load-bearing:

- **`published`** — the manual exists. `scoringKeys` are the real ones and
  `brief` is filled in from it.
- **`awaiting_manual`** — kickoff has not happened. `scoringKeys` stays empty
  and there is no brief.

Nothing here invents a scoring rule for a game nobody has read yet. A season
with no manual shows last season so a team can still practise, and says that is
what it is doing. `lastPublishedPack()` is how.

## Schemas here are a starting point, not the schema

`defaultMatchSchema(year)` / `defaultPitSchema(year)` seed a team's first form.
After that the form belongs to the team and lives in `@vantage/scouting` — teams
add, remove, and rename fields, and nothing downstream may assume the default
shape survived.

## What this package does not know

**What anything is worth.** `scoringKeys` names the fields; it does not say a
fuel cell is four points. Point values come from the team's own value formula
(`org_value_formulas`), which is what lets scouting drive score predictions
without the product guessing the weights. See
[`@vantage/prediction-strategy`](../prediction-strategy/README.md).

## Adding a season

Add `src/packs/<name>-<year>.ts`, export it from `src/index.ts`, and wire it
into `packForYear`. Start it as `awaiting_manual` with empty `scoringKeys` —
fill them in when the manual is actually out, not from a leak or a guess.
`field-centric.ts` holds the fields that recur every season, so a new pack
composes them with `withFieldCentric` rather than restating them.
