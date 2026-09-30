# Navigation and controls polish — September 30, 2026

## Requested outcome

Make Vantage cleaner, more aesthetic, and easier to navigate with fewer redundant buttons. Preserve its features and real workflows, especially saved Home boards, team switching, scouting and its form builder, AI entry points, account controls, and help. Check phone, tablet, desktop, keyboard and accessibility behavior before release. Push the changes for CI; the latest request is to wrap up without waiting for Vercel.

## Implemented

- Desktop Search opens one centered navigation panel, with the underlying sidebar hidden while it is open. Phones retain one hamburger drawer. Escape restores focus to the appropriate opener even after resizing across the 1024-pixel breakpoint.
- The bottom bar retains accessible link names at narrow widths where its visible labels disappear, including unread-message counts.
- Home has less header chrome and tighter spacing; saved boards, their editing controls and data sources are retained.
- Account shows team/role context compactly and uses one Help and support link. The manual, tickets and bug reporting remain in Help centre. Team switching, administration and sign-out remain available.
- Work uses one selector for all six existing filters. Task entry keeps title and Add together. Task cards show status and one completion action; Details contains assignment, dates, status changes, task links and confirmed deletion. Dropdowns have consistent 44-pixel minimum heights.

## Validation and release boundary

67 focused unit tests passed. Workspace typechecks and changed-file lint passed; web typechecking passed again after the navigation changes. Nine final Work/account/Home browser checks passed, including real PostgreSQL task mutations, all six filters, deletion confirmation, 320-pixel layout and accessibility, and help destinations. Earlier Home editing, scouting form builder and team switching journeys passed on phone and desktop.

`shell-navigation-layout.spec.ts` adds duplicate-shell checks at 390, 768, 1023, 1024 and 1440 pixels, navigation bounds, accessibility, actual route changes and focus restoration across resizes. The final navigation/shared-UI regression run and full repository CI are additional release gates; consult the PR check results for their outcome.

No database schema, provider setup, signup eligibility or media-storage behavior changes in this batch. These UI checks do not establish completion of the earlier full production plan, all external integrations, or an Apple/Google/Microsoft usability certification. Production deployment verification remains separate from pushing the branch.
