---
name: vantage-ui-design
description: >-
  The visual and interaction rules every Vantage screen follows (Apple-quality calm, one primary
  action, honest states, readable type, consistent badges, tabs and spacing), with the shared
  components and tokens to use. Use when building or changing any screen, copy or style, and when
  reviewing screenshots.
---

# Vantage UI rules

The bar: a student on a phone at a loud competition understands the screen in two seconds and
finds the one thing to do. Long-form reasoning lives in `docs/UI_DESIGN_RULES.md`; these are the
rules you check every change against.

## Layout

- One page column. Content starts at the same x as the page title and the hub tabs. A tool
  embedded in a hub tab (`.product-hub-panel > .module-page.is-embedded`) adds no second inset.
- A hub's sections stay inside the hub: embed the tool as a tab (see `app/build/build-hub.tsx`)
  instead of linking out and losing the tab bar. Full-screen views (Pit TV) are the exception.
- No cards inside cards. Group with whitespace and a single surface.
- Empty space is fine; an empty card with a heading and nothing in it is not. Hide it or fill it.

## Actions

- One primary (filled) button per view. Everything else is secondary, a text link, or in a
  "More" menu. Steps that only make sense later (Recheck after a scan) appear later.
- Never two buttons that do the same thing on one screen.
- Disabled buttons look disabled (flat, muted). Prefer an enabled button that explains what is
  missing beside the field ("Give the task a title") over a silent disabled one.
- Destructive actions are red, confirmed, and say what will be lost.

## Type and colour

- One sans (`--font-sans`: system face on Apple, Inter elsewhere) and one mono (`--font-mono`)
  for numbers and code only. Never words in mono; never ALL-CAPS labels. Sentence case everywhere.
- Body 15–17px; secondary text 13px; captions and badges no smaller than 11px. Contrast ≥ 4.5:1.
- Colour means something. Badges: red = broken/failed (`app-badge error`), amber = needs setup
  or attention (`setup`), green = done (`good`), neutral = info. Use `EmptyState`'s tone mapping
  (`emptyStateBadgeTone`) instead of picking a colour by hand.
- Use tokens (`var(--ink)`, `--muted`, `--accent`, `--critical`, `--warning`, `--positive`,
  `--surface`, `--line`), never raw hex in product CSS. Check dark mode.

## States

- Every data view has loading (skeleton rows, not a "Loading…" pill), empty (says what to do
  next, one action), error (says what happened, Retry), setup-required (says what to connect)
  and ready. Use `components/ui` (`Shell`, `EmptyState`, skeletons).
- Never show invented numbers. No data → an honest empty state.
- A failure is never labelled "Needs setup", and setup is never shown as an error.
- Keep the last known value while reloading instead of flashing placeholders.

## Forms

- Labels above fields, sentence case, 13px semibold. Errors under the field they are about, in
  red, with the field marked `aria-invalid` and focused.
- Validate each step before Continue; never let a final Submit fail for a field on an earlier
  screen without saying which and linking to it.
- Never pre-tick consent. Show "You agreed on <date>" when it is already on file.

## Touch, keyboard and motion

- Tap targets ≥ 44px on touch screens (40px minimum for desktop segmented tabs).
- `:focus-visible` rings only; headings focused by script show no ring.
- Esc closes dialogs; Enter submits; Tab order follows the page.
- Motion is subtle and respects `prefers-reduced-motion`.

## Copy

- Plain words a 14-year-old understands. Say what the person can do next. No internal jargon
  ("Bind", "RLS", "workspace provisioning"). One name per action across the app (e.g. "Set
  active event" everywhere).
- Owners see owner wording; members see member wording.

## Before you call it done

Screenshot phone and desktop (`vantage-gui-testing`), light and dark, and check: aligned edges,
one primary action, no duplicates, readable text, correct badge colours, sensible empty state,
nothing stuck on "Loading…".
