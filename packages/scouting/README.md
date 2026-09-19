# @vantage/scouting

Scouting forms, entries, and the rules that keep the data trustworthy. Pure
domain logic — validation, payload shaping, conflict resolution, coverage
maths. No database and no React.

## Forms are data, not code

A scouting form is a `SchemaDefinition`: a title and a list of `FieldDefinition`s,
stored per org and per season. Teams build their own in the form builder, so
nothing here assumes a particular game. `@vantage/game-year` supplies the
starting schema for a season; after that it is the team's.

Field values are validated server-side by the same rules the tablet renders
from, so a hand-crafted sync POST cannot smuggle a value past the UI that the
form itself would have refused.

## The identity lock

A scout never types their own name. Entries attribute to the signed-in member,
free-text name fields are stripped from schemas (`stripScoutIdentityFields`)
and from payloads (`lockScoutPayload`), and `isScoutIdentityField` recognises
the many ways a form builder might spell "who scouted this".

This is not a validation nicety. Match data that anyone can sign as anyone is
data you cannot act on, and a pick list built from it is worse than no pick
list.

The copy a scout actually sees lives in `SCOUT_IDENTITY_LOCK_COPY` — one line,
in their words, shared by the live form and the builder's preview so the two
cannot drift.

## Value formulas

`FormulaExpression` + `evaluateFormula` let a team say what their fields are
worth: `add(multiply(field("auto_fuel"), 4), …)`. This is the bridge that lets
scouting drive score predictions, because the team supplies the weights rather
than the product guessing them. Stored in `org_value_formulas`; consumed by
`apps/web/lib/scouting/scouted-ratings.ts`.

## Offline is the normal case

A scout is in a venue with no signal. Entries are written locally, queued, and
synced later, so:

- `clientId` is the identity of an entry, not its database row. The same entry
  re-synced is the same entry.
- Every queued entry carries the `orgId` it was made under and never syncs into
  a different one (`org-isolation.ts`).
- Two scouts can disagree about the same robot in the same match. That is not
  corruption; `resolution.ts` and `trust.ts` decide what to believe, and
  `coverage.ts` says what nobody watched at all.

## Layout

| File | What it holds |
| --- | --- |
| `index.ts` | Schema and field types, validation, `evaluateFormula` |
| `identity.ts` | The identity lock and the copy a scout reads |
| `coverage.ts` | Who is scouting what, and what is uncovered |
| `resolution.ts` | Reconciling two entries for one robot in one match |
| `trust.ts` | How much to believe a given scout's rows |
| `qr-handoff.ts` | Moving entries between devices with no network at all |
| `org-isolation.ts` | The outbox tenant stamp |
| `voice.ts` | Spoken entry parsing |
| `repository.ts` | Query shapes for the app to build on |
