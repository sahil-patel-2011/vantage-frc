# UI cleanup — September 27, 2026

This pass reduces repeated controls and visible explanations while retaining existing routes and workflows.

- Offline storage uses one 2–20 GB slider with a visible value and native keyboard controls. This supersedes the earlier duplicate wheel-and-slider design. Persistence, quotas and unsent-work protection are unchanged.
- One short sync/safety line remains visible. Browser-limit and retention explanations are available under Storage details. Errors and insufficient-space notices remain visible when relevant.
- The drawer has one account-settings destination. Duplicate sign-out and shortcut-edit buttons are removed from its footer; they remain in the account menu and bottom island respectively. Five workspaces, search, team switching, admin access and member shortcuts remain.
- Account help is one Help & support entry. Its destination retains links to the manual, tickets and bug reporting. Existing URLs remain valid.
- Display-setting instructions and workspace descriptions are shorter. Settings rows use quieter surfaces and retain 48px targets.
- Page entrances move without fading text, preserving contrast while asynchronously loaded content appears.

Design references: [Apple layout and progressive disclosure](https://developer.apple.com/design/human-interface-guidelines/layout), [Google communication principles](https://codelabs.developers.google.com/codelabs/material-communication-guidance). These inform the design; no vendor certification or usability score is claimed.

## Verification

- Two focused unit batches: 118 passed; one existing media-dependent test skipped because media uploads remain disabled. Final CSS integrity replay: 20 passed.
- Changed TSX and browser specifications pass lint. The fresh 748-page production build, including TypeScript, passes with platform credentials masked.
- Nine affected browser journeys pass across the final runs against the production build and isolated PostgreSQL. They exercise slider persistence/keyboard/disclosure, member navigation/help, owner navigation/sign-out access, account settings, manual views and phone/desktop accessibility.
- Twenty whole-page axe states pass across Home, account menu, drawer, island editor, Competition, Notifications, Team, Build, Business and Scout at 1280px and 390px. Two scoped storage-panel scans also pass. Automatic scans are not full accessibility certification.
- Phone and desktop storage screenshots were reviewed and updated in screenshots/offline-storage-phone.png and screenshots/offline-storage-desktop.png.

Initial failures are retained in this record: a development-only fixture could not authenticate against the production build; that navigation test now requires real scratch authentication. Real owner access then exposed an ambiguous Team/Team admin test selector; it now scopes workspace assertions to the workspace navigation. A Home contrast failure during its entrance prompted the full-contrast animation fix. A separate sign-in attempt returned HTTP 429; the completed replay preserved rate limiting and used ordinary authentication.

The final nine-case candidate had eight passes and the one ambiguous selector failure. After correcting only the selector, the remaining unchanged navigation journey passed separately without retries. No assertions or accessibility rules were disabled.

Production remains unchanged. The release blockers in STATUS.md still apply; this UI pass does not authorize an early signup opening or establish production acceptance.
