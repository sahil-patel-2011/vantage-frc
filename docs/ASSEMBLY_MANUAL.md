# Assembly manual

Turns a team's Onshape assembly into a printable, step-by-step build book — the
LEGO-instructions idea, applied to a real FRC mechanism.

Route: `/assembly-manual` (Build › CAD). Engine: `apps/web/lib/assembly-manual`.
Queue: `packages/free-relay/src/assembly-manual.ts`. Table: `assembly_manual_runs`
+ `assembly_manual_steps` (`packages/db/migrations/0642_assembly_manual.sql`).

---

## What it produces

* **A materials and cut list** up front: one row per distinct part, with the
  count the assembly uses, the length and section measured from CAD, and the
  material Onshape has assigned.
* **A hardware list**: every part classified as a fastener, counted.
* **Numbered steps**, one per part instance. Each step carries
  * a render from Onshape of the real geometry,
  * a parts callout with quantities (identical hardware collapses into one line),
  * fabrication instructions where the CAD supports them — "Cut 1.00 in × 1.00 in
    stock to 17.50 in", "Drill Ø0.196 in (#9) through, 4 places", "Tap 10-32,
    4 places (tap drill #21)",
  * any feasibility check that failed, in plain English.
* **A run report** — how the build order was derived, how many checks passed,
  where the two ordering strategies disagreed, and what the CAD could not say.
* **A PDF** to print, and the same steps to read on the page.

---

## Why it is a queued job

A full robot assembly is several hundred instances, and every step wants its own
Onshape render. Onshape is rate-limited and slow, and the honest estimate for a
whole robot is hours. So:

* Starting a run inserts a `queued` row and returns. Nothing is built in a
  request handler.
* A worker **leases** the run (`lease_owner`, `lease_expires_at`) and advances it
  for one bounded slice — four minutes by default — then hands it back.
* Every slice writes a `checkpoint`: the stage, the distilled CAD facts, the
  plan, and a cursor. A relay that is unplugged mid-render resumes at the step it
  reached, not from the first Onshape call.
* Two relays cannot advance the same run: a run is claimable only when its lease
  has expired, and every checkpoint renews the lease.

Stages, in order: `ingest → graph → order → fabrication → render → write → pdf`.
The step rows appear at the end of `fabrication`, so the viewer shows the build
order before the (slow) renders start.

### Running the worker

Either:

* the free-relay sweep (`npm run sweep --workspace=@vantage/free-relay`), which
  now also advances assembly-manual runs — but only when an engine has been
  registered, which the Pi relay alone cannot do; or
* `POST /api/cron/assembly-manual` with the `CRON_SECRET` bearer, from whatever
  ticker the deployment uses. This is the path that works out of the box, because
  the web app is where the engine, the Onshape tokens and the KMS all live.

One tick advances one run by one slice. Call it on a timer; a long job simply
takes many ticks.

---

## The honesty rules

This feature is only worth having if a student can act on it without checking.
So the rules are structural, not a matter of care:

### Every measurement traces to a CAD fact

| Manual says | Comes from |
| --- | --- |
| a cut length | the part's Onshape bounding box, **and** an extrude feature whose depth matches it |
| a hole diameter | the `holeDiameter` expression on a `hole` feature |
| a drill designation (#9, 1/4) | that diameter, matched to the ANSI series within 0.0005 in |
| a thread | a hole feature that says `TAPPED` **and** names a size |
| a tap drill | the published table for that named thread |
| a mass | Onshape `/massproperties` for that part |
| a material | the material assigned to the part in Onshape |
| the build order | the assembly's mates and the parts' bounding boxes |

### Where the CAD does not say, the manual says so

Any line the CAD does not support prints **"confirm — not specified in CAD"** as
part of its own text — not as a style, not as a tooltip, so no renderer can drop
it. That covers, among others:

* a tube whose length is only its modelled size, with no feature setting it;
* a hole feature whose diameter expression cannot be evaluated exactly (a
  variable reference like `#tubeLength`, or arithmetic);
* a tapped hole with no thread designation;
* a hole feature whose count is not readable;
* a part with no material assigned;
* an extrude that removes material at a size we cannot read.

A diameter that merely happens to equal a tap drill is **not** a thread spec, and
a diameter more than half a thousandth from any standard drill gets no
designation at all.

### Feasibility is checked, not assumed

Four checks run for every step, against boxes Onshape measured:

* `prerequisites` — the parts this one mates to are already on the bench;
* `fastener_order` — a fastener never precedes a part it joins;
* `reachable` — the part can be brought in along at least one axis without
  passing through something already placed;
* `head_clear` — a fastener has a clear run along its own axis at one end, so a
  driver can reach it.

`reachable` and `head_clear` sweep the part's axis-aligned bounding box. That is
coarse, and coarse in the safe direction: a box is bigger than the part inside
it, so the check can warn about a step that would have been fine, but cannot
clear a step that is genuinely enclosed.

### The order is derived twice

* **Mate dependency** — seed with the most-mated part, then repeatedly take the
  part with the most already-placed neighbours. Follows how the designer said it
  goes together.
* **Geometry first** — biggest structural member out of the box, then the biggest
  remaining part that touches what is on the bench. Follows how a person builds.

Both are scored against the same checks; the higher score wins (a tie goes to the
mate order, because the designer's constraints beat a bounding-box heuristic).
Every place the two disagree is counted and listed in the report. A third pass
replays the chosen order from an empty bench and, where a step fails, tries
moving that part to a nearby position that scores better. A part it cannot fix
**stays in the manual** with its failing checks printed — dropping it would give
the team a book that quietly omits part of their robot.

### Renders are real or absent

Every picture is an Onshape shaded view of the team's own geometry. The engine
tries, in order:

1. the assembly shaded view with a hidden-occurrence body — the ideal step
   picture, the partial build (`assembly_hidden`);
2. a shaded view of the individual part being added (`part`);
3. the whole-assembly render, fetched once (`assembly_full`);
4. nothing (`none`).

**Onshape's documented assembly shaded-view endpoint does not take a
hidden-occurrence list**, so on a stock deployment mode 1 is refused once and
never retried, and steps come back as mode `part`. The mode is stored per step,
printed under the picture and totalled in the report, so a reader always knows
whether they are looking at the partial build or at one part. When there is no
render at all the step shows a labelled placeholder saying which call failed.
There is never a generic cube, a stock photo, or a picture of a different robot.

### The model writes sentences, and nothing else

The metered model (feature `assembly_manual`) is used for exactly two things:
phrasing a step's sentence from facts already derived, and naming a sub-assembly
from the part names in it. It never sees the CAD, never chooses the order, and
never supplies a measurement.

Two guards enforce that:

* every number in a generated sentence must appear in the facts that were handed
  in, or the sentence is discarded;
* a sentence mentioning a torque, thread-locker, lubricant or adhesive that the
  facts do not mention is discarded — none of those exist in a CAD model.

With no model available at all the manual completes with deterministic sentences
and the report says so. In the worker the free-relay adapter is used (the same
one `memory-dream` uses), so a team's paid credits are not spent on prose; the
one request-path model call — re-wording a single step on request — goes through
`meteredAI`.

---

## What it cannot know from CAD

Worth saying to a team before they read the book:

* **Torque, thread-locker, lubricant, adhesive.** Not in the model. Never stated.
* **Which part a hole belongs to** when a Part Studio holds several. The feature
  tree is per studio, and resolving a feature to a body needs a FeatureScript
  evaluation this engine deliberately does not run against a team's live
  document. Such lines say how many parts the studio holds.
* **Whether a modelled length is a cut length.** See above — unconfirmed unless a
  feature sets it.
* **Sub-assembly boundaries beyond FASTENED mates.** A clump joined only by
  FASTENED mates is rigid by Onshape's own definition, and that is what the
  engine calls a sub-assembly. A REVOLUTE mate is where one ends.
* **Anything about a part that is not mated.** Unmated instances are ordered by
  size and the report says how many there were.
* **COTS part numbers**, unless the parts catalog is installed. Without it,
  hardware lines use the CAD's own part name plus measured dimensions, which is
  a real fact about the team's design. A wrong SKU would be worse than no SKU.
* **Interference and collision.** The checks use bounding boxes, not the actual
  solids. They catch "this is enclosed" and "you cannot reach that bolt"; they do
  not replace an Onshape interference check.

---

## How to model so the manual is complete

Ordered by how much difference each one makes:

1. **Mate the assembly.** With no mates the build order falls back to geometry
   alone, and the manual says so. Mates are the single biggest input.
2. **Use FASTENED mates for things that do not move**, and a real joint mate
   (REVOLUTE, SLIDER, CYLINDRICAL) for things that do. This is what separates
   sub-assemblies from each other.
3. **Name parts the way the shop says them.** "10-32 x 1.00 SHCS", "1x1 box tube
   0.0625 wall". Fastener classification believes the name first, the parts
   callout prints it, and the catalog matches on it.
4. **Model stock at its cut length, using an extrude with an explicit depth.**
   That is what turns "measures 17.50 in" into "Cut to 17.50 in".
5. **Use the Hole feature, not an extruded circle.** A hole feature carries a
   diameter, a depth, a through/blind flag, a count and — if you use it — a
   thread. An extruded cut carries none of that, and becomes a note saying
   material comes off with no size stated.
6. **Set the thread on tapped holes.** A tapped hole with no named size prints
   the caveat rather than the thread.
7. **Assign materials.** Onshape's material is what the cut list prints.
8. **One part per Part Studio where you can**, or at least keep related parts
   together. A studio with several parts makes hole callouts ambiguous and the
   manual says so on every line.
9. **Do not suppress features you still want in the manual.** Suppressed features
   are skipped: a suppressed hole is not drilled.

---

## Data model

`assembly_manual_runs` — one row per run. `status` (queued/running/paused/
completed/failed/cancelled), `checkpoint jsonb` (stage + facts + plan + cursor),
`progress jsonb`, `report jsonb`, `pdf bytea`, lease columns, `cancel_requested_at`.

`assembly_manual_steps` — one row per step, with `parts`, `fabrication`,
`feasibility` and `disagreement` as jsonb, plus `render_png bytea`,
`render_mode` and `render_note`.

RLS: every member of the org reads both tables — the manual is for whoever is
holding the wrench. Only owners and admins insert a run, and `started_by` must be
the caller. There is **no** app-role write path for steps: a step is a derived CAD
fact, and if it is wrong the fix is to change the CAD and re-run. The worker
writes on `vantage_worker`, which bypasses RLS.

Cancelling sets `cancel_requested_at` rather than writing `status`: the run may
be mid-slice on another machine, and two writers racing on `status` is how a
finished run ends up marked cancelled.

---

## API

| Method | Path | Who | Does |
| --- | --- | --- | --- |
| `GET` | `/api/assembly-manual` | member | runs, vault documents with Onshape links, Onshape connection state, last worker check-in |
| `POST` | `/api/assembly-manual` | owner/admin | `action: "start"` queues a run (resolving the assembly element, or returning a picker); `action: "rewrite-step"` re-words one step through `meteredAI` |
| `GET` | `/api/assembly-manual/[runId]` | member | the run, its report, and a page of steps (no images) |
| `DELETE` | `/api/assembly-manual/[runId]` | owner/admin | request a cancel |
| `GET` | `/api/assembly-manual/[runId]/step/[n]` | member | that step's PNG |
| `GET` | `/api/assembly-manual/[runId]/pdf` | member | the printed manual |
| `GET`/`POST` | `/api/cron/assembly-manual` | `CRON_SECRET` | advance the queue by one slice |

A miss on the binary routes is a 404 whether the run belongs to another team,
does not exist, or has not finished — so run ids cannot be probed.

---

## Tests

`apps/web/lib/assembly-manual/*.test.ts`, all credential-free:

* `order.test.ts` — the sweep geometry, the four checks, and a synthetic
  assembly where the naive order is genuinely infeasible (a wheel goes on before
  the motor screws and blocks a driver at both ends of the shank). Asserts both
  strategies produce that infeasible order, that the engine rejects it, and that
  the shipped order passes every check.
* `fabrication.test.ts` — every "confirm — not specified in CAD" branch, the
  drill table's refusal to name a near-miss, and the cut list.
* `pdf.test.ts` — re-parses the produced PDF, walks the xref table and asserts
  every offset lands on the object it claims; round-trips a PNG through all five
  filter types; checks the placeholder path emits no image.
* `run.test.ts` — the stage machine across two slices against a fake database and
  a clock the test drives: it must stop mid-render, resume at the cursor, and
  never re-render a step or re-fetch the cover.
* `ingest.test.ts` — the Onshape payload parsers, and ingest resuming from its
  cache without repeating a call.
* `write.test.ts`, `graph.test.ts`, `cots.test.ts` — grounding, fastener
  classification, and the optional catalog.
