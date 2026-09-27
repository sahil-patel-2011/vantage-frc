# Shared UI acceptance

This is a bounded evaluation of Vantage's shared UI. It is not Apple, Google, Microsoft or Tesla certification. Aesthetic quality and first-time task success need representative FRC users; automated tests cannot establish a universal 90–100% usability score.

## Design decisions

- Use glass for the personal shortcut island, with opaque content surfaces. Keep text legible and reduce effects when motion, transparency or contrast preferences require it.
- Keep Home, Competition, Team, Build and Business as the five workspaces. Put Logistics in Team and robot profiles in Competition. Preserve direct URLs and real application services.
- Keep the personal four-shortcut island plus its explicit Apps customization button. Shrink the container without shrinking the 48-pixel controls.
- Show actual notification counts for the selected inbox. Mark only visible live alerts as read; retain history and deliberate manual unread state.
- Group account actions, team switching and help. Keep long team names readable, roles subordinate and keyboard behavior predictable.
- Use ordinary team-switching links with the current team identified. Keep Competition section controls at least 48px; preserve island edits when preference requests finish late, and allow unavailable saved shortcuts to be removed.

## Primary references

- [Apple materials](https://developer.apple.com/design/human-interface-guidelines/materials): glass belongs in the functional navigation layer; use it sparingly and preserve legibility.
- [Apple accessibility](https://developer.apple.com/design/human-interface-guidelines/accessibility): contrast, interaction targets and accessibility testing.
- [Tesla touchscreen](https://www.tesla.com/ownersmanual/model3/en_ie/GUID-518C51C1-E9AC-4A68-AE12-07F4FF8C881E.html): persistent common controls, customizable My Apps, search inside Controls and contextual details. These are documented behaviors; transferring them to Vantage is a design judgment.
- [Google accessible views](https://developer.android.com/guide/topics/ui/accessibility/views/apps-views): 48dp targets as a mobile design reference. Vantage uses CSS pixels, not Android dp.
- [Microsoft accessibility testing](https://learn.microsoft.com/en-us/windows/apps/design/accessibility/accessibility-testing): combine automated checks with manual keyboard and assistive-technology testing.
- [W3C menu-button pattern](https://www.w3.org/WAI/ARIA/apg/patterns/menu-button/) and [menu keyboard behavior](https://www.w3.org/WAI/ARIA/apg/patterns/menubar/).

## Checks and evidence

| Category | Acceptance check | Evidence |
| --- | --- | --- |
| Feature preservation | Existing URLs, saved Home boards, permission gates, specialist editors and transaction services remain available | Source parity audit and existing regression suite |
| Navigation | Five clearly described workspaces, current destination visible, drawer search, close/focus return, no overlapping menus | Desktop browser and source audit |
| Personal controls | Capsule geometry, translucent material, five controls at least 48px, persistent saved choices, cancellation and keyboard focus | Browser geometry, customization journey and preference regressions |
| Notification accuracy | Empty selected inbox has no badge; visible acknowledgment updates badge/history; manual unread persists; other people/teams remain inaccessible | Actual PostgreSQL integration and browser journeys |
| Responsive layout | No horizontal overflow in shared shell, long-name account menu and workspace views at tested widths | Desktop and phone screenshots/geometry |
| Keyboard access | Account arrows/Home/End/typeahead/Space/Escape/Tab; editor focus trap and restoration; drawer focus return | Manual browser checks |
| Reliability | Bounded requests, stale response rejection, atomic grouped reads, cross-tab updates | Source audit, integration tests and bounded browser checks |
| Visual accessibility | Readable contrast, focus styles, reduced motion/transparency and forced-color fallbacks | Computed styles plus source checks; assistive-technology/OS preference checks remain separate |

Concrete results, viewport sizes, build identity, screenshots and limitations are recorded in `evidence/ui-glass-refresh.json` after the final browser run. A passing category means its listed checks passed in that scope; it does not establish whole-app usability or full WCAG conformance.

The subsequent [deep-detail evidence](evidence/ui-deep-details.json) records the failed candidate CI run and its local repairs, including selected-event context, truthful onboarding, timeout recovery, late preference response races and unavailable shortcut removal. Generated-cache and numerical precision failures are retained with their repaired reruns. Explicit skips and full production gates remain visible.

## Remaining evaluation

Run first-use tasks with student scouts, mentors and pit leads on actual competition devices. Measure completion rate, elapsed time, wrong destinations and recovery from errors. Run screen-reader, zoom, forced-color, reduced-effect and offline checks across supported browsers. Every shipped workflow still requires the full production completion matrix; this UI work does not waive deployment, provider, recovery or load gates.
