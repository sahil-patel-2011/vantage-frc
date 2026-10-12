---
name: ui-ux-research
description: Researches current Apple, Google, and Microsoft UI and UX guidance before designing or changing Vantage screens. Use when the user asks for design, layout, visual polish, usability, accessibility, empty states, navigation, or best practices for interface design.
---

# UI and UX research

Look up the current official pages before choosing a layout or interaction. Do not design from memory.

## Sources

Read the pages that match the decision:

- Apple Human Interface Guidelines: https://developer.apple.com/design/human-interface-guidelines
- Apple foundations (layout, color, typography, accessibility): https://developer.apple.com/design/human-interface-guidelines/foundations
- Material Design 3: https://m3.material.io/
- Fluent 2 principles: https://fluent2.microsoft.design/design-principles
- Fluent 2 accessibility: https://fluent2.microsoft.design/accessibility

## Apply the overlap

These three systems agree on the bar Vantage should meet:

- One primary action per view. Secondary actions stay visually quieter.
- Body text at least 4.5:1 contrast. Large text and meaningful icons at least 3:1.
- A visible label for every field. Placeholder text is a hint, not the only instruction.
- Keyboard focus, semantic headings, and link text that makes sense alone.
- Layouts that reflow for a phone and a desktop. Touch targets stay easy to hit.
- Motion that can be reduced, and color that is not the only signal.

## Vantage constraints

Keep the product rules already in `docs/FEATURE_MAP.md`: empty screens have one primary action, missing numbers stay blank, setup says what to configure, and student chrome avoids internal system names.

After a visual change, check the affected screen and one neighboring screen at a desktop width and a phone width on https://vantagefrc.vercel.app.
