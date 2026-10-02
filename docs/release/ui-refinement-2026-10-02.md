# Product UI refinement — October 2, 2026

The shared product finish now uses the actual locally bundled Inter face, consistent theme-aware surfaces, quieter card borders and shadows, visible keyboard focus, and comfortable controls. A root CSS alias previously hid Next's font variable; rendered Home used a fallback font and a conflicting late rule inflated the greeting to 42px. The corrected desktop greeting renders at 34px with Inter.

Home keeps its existing saved boards and placement. Its card headings and spacing are consistent, while task titles use hover and focus states rather than persistent underlining. Shared Card padding remains explicit (`none`, `sm`, `md`, `lg`) instead of being overwritten by global theme padding. Scouting questions use separators within one report rather than nested rounded boxes. The account identity remains visible with a smaller, palette-aware avatar so settings appear sooner.

## Verification

- 83 focused unit checks passed across five files, including the required media availability, dashboard drag and catalog checks.
- Existing free scouting journeys passed at 390px and 1440px: Pit default, large tap choices, keyboard selection, draft recovery, offline upload, exactly-once persistence, and identity isolation. Compact navigation also passed.
- Home reading and saved edit-grid checks passed at phone and desktop widths, including a late-match card at 320px. Stock Home creation/completion, external task updates, stale-response protection, calendar updates, and actual match updates passed at 390px and 1440px.
- The reconnect/failed-write journey passed on a warmed rerun after its first 5-second wait expired while the local development page was loading. Failed writes preserve the draft and never report successful task creation.
- The added product appearance journey passed at 390px and 1440px in both Light and Dark. It checks actual Inter rendering, no horizontal overflow, the initially closed menu, theme selection, and pit report selection/cancellation. Axe reported zero violations on the reviewed Home, Account, and practice scouting surfaces.
- Targeted ESLint and `git diff --check` passed. The isolated production build passed.

All functional tests used a dedicated loopback PostgreSQL test database and masked external credentials. Screenshots contain test data, not live team records. The stock Home test restores its original board; the appearance test restores its original account theme. These checks cover the changed surfaces and relevant workflows, not every button in the entire application.

## Visual evidence

- [Stock Home, desktop](evidence/ui-refinement-2026-10-02/home-desktop.png)
- [Pit report, desktop](evidence/ui-refinement-2026-10-02/pit-desktop.png)
- [Pit report, dark phone](evidence/ui-refinement-2026-10-02/pit-dark-phone.png)
- [Settings, desktop](evidence/ui-refinement-2026-10-02/settings-desktop.png)

Release uses the existing `main` Git integration for `sahil-patel-2011/vantage-frc` and `vantage-frc-web`; deployment readiness is verified separately against the pushed commit.
