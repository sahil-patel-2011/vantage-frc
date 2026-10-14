# Vantage brand usage

The Vantage symbol is a geometric V: three input lines converge into one blue decision point, then resolve into one strong path. It represents source data becoming a reviewable team decision.

## Core tokens

- Ink / navy: `#14243A`
- Signal cobalt: `#1457D9`
- Dark-surface signal: `#6E9BFF`
- Warm canvas: `#FAF9F6`
- White surface: `#FFFFFF`
- Hairline: `#D9DDDF`
- Muted text: `#536172`

Use cobalt only for actions, active state, provenance signals, and the decision point in the mark. Do not add gradients, glows, alliance colors, or decorative color variants.

## Interface accent

Signal cobalt is the mark's colour. The product interface (the app, the Scouting app and sign-in) has one
accent token, `--accent`, defined once in `app/macos-product.css`:

- Light: `#075DCC` (white text on it 6.1:1; on white 6.1:1)
- Dark: `#8DB7FF` (on the dark card 8.9:1), with `--accent-ink` `#11254B` for filled buttons

A team's own colour (Account → Appearance) replaces it through `data-brand-accent`. Components
read `var(--accent)` and never write a blue of their own. The public site (home, features,
pricing, legal pages) keeps its own light palette (`lib/marketing/public-theme.ts`).

## Assets and clear space

- `vantage-logo.svg`: standard horizontal lockup on light surfaces
- `vantage-logo-dark.svg`: horizontal lockup on navy/dark surfaces
- `vantage-logo-stacked.svg`: centered presentation lockup
- `vantage-logo-mono.svg`: one-color reproduction
- `vantage-mark*.svg`: compact light, dark, and monochrome marks
- `icon.svg`: favicon/PWA app tile
- `vantage-social.svg`: social/OG lockup

Keep clear space around a lockup equal to at least half the symbol width. Use the compact mark at 16–32 px; use the horizontal lockup at 120 px or wider. Never stretch, rotate, outline, recolor, or place the mark over busy imagery.
