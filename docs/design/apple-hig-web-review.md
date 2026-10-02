# Apple HIG review for Vantage

Vantage is a web application. Use Apple's Human Interface Guidelines to review its interaction design; React, Next.js and PostgreSQL remain the implementation. This checklist is a design review, not an Apple certification.

## Navigation and hierarchy

- Keep the primary work visible. Use one main action for the current task and lower-emphasis alternatives.
- Keep the hamburger closed until requested. Preserve keyboard dismissal and focus return.
- Team context is a label. Switching and joining teams belong in Settings → Your teams.
- Group related settings by purpose and keep secondary form configuration inside the relevant question.
- Render the saved Home board through the same layout model in the editor and Home. Data refreshes must not remove cards or change chosen sizes.

## Controls and data entry

- Give controls clear action labels, visible press/focus states, and generous hit regions. Use 44 CSS pixels as a practical web target floor; Apple expresses its native recommendation in points.
- Distinguish alternatives using emphasis rather than mismatched sizes. Pit and Match are a coherent set of choices.
- Gather team identity from the authenticated account. Ask for the robot number first; ask for a match only in Match scouting.
- Default to the latest released game's form. Keep prior games available for off-season work.
- Preserve drafts through errors. A save message must follow successful persistence. Cancellation must not delete an existing submitted report.
- Keep absent answers absent in tables, charts and score features. A recorded zero is meaningful and distinct from no observation.

## Accessibility and visual presentation

- Check phone and desktop overflow, keyboard navigation, named inputs, dialogs, scrollable tables, and focus return.
- Check text contrast in light and dark modes. Aim for WCAG AA's 4.5:1 for ordinary text and 3:1 for large text.
- Respect reduced motion. Use semantic text as well as color for state and results.
- Keep decorative translucency away from dense form content and preserve legibility over backgrounds.
- Verify real workflows through browser, API, database and returned view. An accessibility scan alone does not demonstrate a feature works.

## Applicability of the supplied Apple references

SwiftUI, UIKit, AppKit, app extensions, Apple File System and iCloud Backup documentation concern native Apple implementations. They are useful architectural references when adding native integrations, but do not require adding those frameworks to this web app. App Store Connect and developer-account procedures apply if a native distribution is introduced. Marketing, Apple Pay, Wallet and trademark guidance applies when those services or Apple-branded assets are actually used. Vantage's own controls and brand should not imply Apple endorsement.

## Primary sources

- [Human Interface Guidelines](https://developer.apple.com/design/human-interface-guidelines/)
- [Buttons](https://developer.apple.com/design/human-interface-guidelines/buttons): visual hierarchy, clear labels, hit regions and feedback.
- [Entering data](https://developer.apple.com/design/human-interface-guidelines/entering-data): sensible defaults, choices, validation and automatic identity.
- [Accessibility](https://developer.apple.com/design/human-interface-guidelines/accessibility): input methods, legibility and contrast.
- [Color](https://developer.apple.com/design/human-interface-guidelines/color): semantic consistency and appearance adaptation.

Keep evidence and limitations in the release report. Do not describe an untested route or unsupported platform as fully verified.

## Supplied platform and distribution references

Retain these references for future native work. They do not introduce native framework dependencies into the current web release.

| Reference | Application to Vantage |
| --- | --- |
| [SwiftUI](https://developer.apple.com/documentation/swiftui), [UIKit](https://developer.apple.com/documentation/uikit), [AppKit](https://developer.apple.com/documentation/appkit) | Native implementation references. The current interface uses React and semantic browser controls. |
| [App extensions](https://developer.apple.com/documentation/technologyoverviews/app-extensions) | Consult when implementing an Apple platform extension. Current integrations use web APIs and the existing connector architecture. |
| [iCloud Backup data](https://developer.apple.com/documentation/foundation/optimizing_your_app_s_data_for_icloud_backup/), [Apple File System](https://developer.apple.com/documentation/foundation/file_system/about_apple_file_system) | Native storage references. Web records remain in PostgreSQL; local scouting drafts and queues retain their existing browser storage and recovery tests. |
| [App Store Connect](https://developer.apple.com/help/app-store-connect/), [Developer accounts](https://developer.apple.com/help/account/) | Distribution procedures for a future native app. The current release uses the connected GitHub repository and Vercel deployment. |
| [App Store marketing](https://developer.apple.com/app-store/marketing/guidelines/), [Apple Pay](https://developer.apple.com/apple-pay/marketing/), [Wallet](https://developer.apple.com/wallet/add-to-apple-wallet-guidelines/) | Apply only when using the relevant Apple distribution or service assets. |
| [Apple trademarks and copyrights](https://www.apple.com/legal/intellectual-property/guidelinesfor3rdparties.html) | Use Vantage's own brand and assets; do not imply Apple endorsement. |
