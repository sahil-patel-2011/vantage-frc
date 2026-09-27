# Navigation and event-free scouting verification

This release consolidates navigation and adds practice/video scouting without an event. It does not declare the broader production-completion plan finished.

## Behavior and feature preservation

- Five workspaces: Home, Competition, Team, Build, Business. One section expands at a time. Search, team switching, settings, account controls and the customizable bottom island remain.
- Travel and logistics live under Team > Calendar. Pit groups robot checks, readiness, repairs and Pit TV. Existing URLs and hub tools remain available.
- DashboardHomeView and saved-board APIs remain unchanged. No invented dashboard metrics or media storage were introduced.
- Scout without an event starts with a team number, session label, form and season. Existing season fields collect match or pit observations. Event scouting and custom event forms remain available.
- Drafts survive refreshes. Submitted reports persist in account-scoped IndexedDB before upload. Retries acknowledge the same immutable report ID. User and organization checks prevent another signed-in account from claiming queued reports.
- Practice reports retain raw labeled observations and form definitions, support JSON export and authorized deletion, and never enter official event aggregates. Readable team workbooks include a separate PracticeScouting table; prefixed JSON chunks preserve long payloads without formula execution.

## Evidence

- Full unit suite: 11,059 passed; 29 existing conditional skips. Regression coverage includes navigation, shared dashboard behavior, media gating, scouting validation and migration checks.
- Workspace type checks, lint and a local production build passed.
- Fresh isolated PostgreSQL: all migrations plus idempotent runner replay passed. Integration proofs cover cross-organization reads/deletes, forged scout identity rejection and zero-valued observations (3 tests).
- Real authenticated browser journeys at 390 and 1440 pixels: no-event entry, refresh recovery, offline save, reconnect upload, idempotent resend, identity rejection, raw results and no horizontal overflow.
- Keyboard/menu checks cover reachable workspaces, search, 48-pixel disclosure controls and focus return after Escape. Light/dark/system theme browser journeys cover shared controls.
- Automated axe WCAG A/AA checks: zero violations in eight samples (menu and practice screen, phone and desktop, light and dark). These are sampled automated results, not a certification or a user-study score.
- Before schema changes, checkpoint `checkpoint-2026-09-27T18-02-58.575Z` restored 719 tables into an isolated PostgreSQL database with matching counts. Its encrypted Google copy passed write/read-back verification. The encryption key is held separately. This is a release checkpoint, not proof that the entire planned journal/retention system is complete.

## Design references and scope

Independent implementation informed by [Lovat collection](https://github.com/HighlanderRobotics/lovat-collection) and [dashboard](https://github.com/HighlanderRobotics/scouting_dashboard_app): direct manual entry, contextual collection and visible saved observations. No Lovat source was copied. This release does not claim complete Lovat feature parity.

Navigation decisions follow [Microsoft navigation guidance](https://learn.microsoft.com/en-us/windows/apps/design/basics/navigation-basics), [Material navigation guidance](https://m3.material.io/components/navigation-bar/guidelines), [Apple materials guidance](https://developer.apple.com/design/human-interface-guidelines/materials), and [Tesla touchscreen guidance](https://www.tesla.com/ownersmanual/2020_2024_modely/en_gb/GUID-518C51C1-E9AC-4A68-AE12-07F4FF8C881E.html): clear hierarchy, restrained surfaces and easy access to frequent actions. There is no common Apple/Google/Microsoft/Tesla percentage score for intuitiveness. Timed sessions with scouts and mentors are still needed to measure learnability.

Practice history currently displays and exports the latest 200 uploaded reports plus this account's pending device reports; the screen discloses that limit. Pending uploads retry while practice scouting is open and after reconnecting. Full automatic provisioning, recovery-journal acceptance, personal Codex and all production-plan journeys remain separately tracked work.
