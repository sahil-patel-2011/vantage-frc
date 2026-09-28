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
- [Playwright accessibility testing](https://playwright.dev/docs/accessibility-testing): scan the intended rendered state with axe, and combine automated checks with manual evaluation.

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

The [accessibility audit](evidence/ui-accessibility-audit.json) runs the default axe rule set against actual signed-in scratch data in the production build: Home, account menu, drawer, island editor, Event day and Notifications at 1280px and 390px. All twelve settled-state scans have zero automatically detected violations. Native dialog/list semantics and warning-text contrast were repaired. Incomplete gradient/overlap contrast checks remain in the evidence for manual review; the account trigger's controlled menu ID was verified in the actual browser. No rules or page regions were excluded. The two permanent browser regressions attach all violations and incomplete checks to their reports.

CI run 36290241694 passed quality and PostgreSQL/RLS. Two browser failures and eight retry-only passes remain in its five complete shard reports. Shard five was terminated by the runner after a navigation timeout and could not publish its remaining results. Local repaired form/safety/first-run journeys pass eleven tests. Next.js's supported full memory eviction is enabled only in CI development sessions to address retained cold-route compilation; the subsequent full CI run must still establish that repair.

## Remaining evaluation

Run first-use tasks with student scouts, mentors and pit leads on actual competition devices. Measure completion rate, elapsed time, wrong destinations and recovery from errors. Run screen-reader, zoom, forced-color, reduced-effect and offline checks across supported browsers. Every shipped workflow still requires the full production completion matrix; this UI work does not waive deployment, provider, recovery or load gates.

The final built candidate `epbhuK3I35yD78a1mBlwq` passes twenty default axe scans across Home, account, drawer, island editor, Event day, Notifications, Team, Build, Business and Scout at desktop and phone widths. The embedded landmark, tablist, scouting contrast, calendar heading and hidden Build season-control findings are repaired, with the original failures retained in [workspace repair evidence](evidence/ui-workspace-accessibility-repairs.json). Full lint and the fresh production build pass. CI 36291289125 passed quality/PostgreSQL but three browser runners terminated before reporting complete results; this is not a full pass. The next candidate runs bounded six-file server groups on eight isolated shards, with exact planned/reported case coverage checked before and after merging reports. A genuine two-server local harness proof passes both selected tests. Full remote CI, manual assistive-technology evaluation and the original production gates remain required.

The final candidate `ej9yST5ocX2ZfrFnGSp-R` passes 48 default axe scans on the production build, split between [primary UI](evidence/ui-accessibility-audit.json) and [embedded tools](evidence/ui-embedded-accessibility-audit.json). All four permanent browser tests pass against actual scratch authentication/data at 1280px and 390px. Loading borders animate without fading text; content entrances retain readable text. Embedded Playbook, People, Practice, robot risk, batteries, prototypes, My Day, checklists, scouting forms, chemistry, pick clock and sponsor packages retain standalone pages while sharing one workspace landmark. Logistics loading/error/empty states forward the same embedded state. The original findings and their repaired replays remain recorded. All workspace types, focused lint, 17 motion/coverage/environment tests and the fresh 746-page build pass. Candidate CI 36292900870 completed without runner interruptions: quality/PostgreSQL passed; seven complete browser reports contain 332 expected passes, two accessibility failures and five explicit skips, while shard two stopped at coverage preflight before executing its 47 planned cases. Both causes are repaired; the final remote rerun is still required. These UI results do not close the full production configuration, provider, recovery, load or workflow gates.

Final full CI [36294203960](https://github.com/sahil-patel-2011/vantage-frc/actions/runs/36294203960) passes on source revision `2045bc2569ca81cf8460f9c7f96c0c9244ca9b95`: lint, every workspace type check, 1,498 unit files / 11,191 tests, migration checks, isolated PostgreSQL/RLS and the 746-page build. All eight browser shards complete with 383 passes, zero failures, zero retry-only passes and five explicit skips. Each shard proves exact planned/reported coverage; all 388 cases are accounted for. The unit run retains 15 skipped files / 40 skipped tests; conditional onboarding/invitation/inbox PostgreSQL checks run separately. Skip reasons and original failed candidates remain in [final CI evidence](evidence/ui-release-ci.json) and [candidate history](evidence/ci-ui-candidate.json). This closes the bounded UI/code regression rerun, with 48 production-built axe states passing. It does not open signup or waive the production release gates; no main merge, deployment or production migration was performed.


Marketing refresh (2026-09-27): the public site now describes the complete FRC workspace, with a navigable product map, restrained teal styling and corrected offline, AI, CAD, navigation, privacy/export and pricing claims. The existing product and release gates are unchanged. Focused lint/types, 63 unit checks, 26 development browser checks and a 746-page local build passed; all 16 default axe scans of eight built public routes passed with incomplete findings retained. Two broader production-mode checks remain non-passing because email-provider configuration is absent and one test uses development-only authentication. Actual Chrome opened the saved Home board through the marketing link. See [marketing review](MARKETING-REVIEW.md) and [evidence](evidence/marketing-refresh.json). No production deployment, signup opening or main merge occurred.
