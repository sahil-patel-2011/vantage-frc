# Git release and Vercel Web Analytics

This release puts the previously reviewed navigation, scouting, dashboard editing and team onboarding work into the connected GitHub repository. The intended production path is a push to `main` in `sahil-patel-2011/vantage-frc`, followed by Vercel's existing Git integration for `vantage-frc-web`.

Vercel Web Analytics was already enabled in that project. The web workspace now installs `@vercel/analytics` and mounts its Next.js component from the root layout, gated by the existing analytics choice. The collector loads only after a current opt-in. Every event rechecks consent; withdrawing consent stops new page views even if the collector is already loaded. No custom content events are sent to Vercel. Page-view URLs omit query strings, fragments, credentials and identifier-shaped path segments.

The banner and privacy policy disclose Vercel's traffic summaries and approximate geography separately from Vantage's existing account-identified product events. Consent version 2 requires a fresh choice for this changed disclosure; a previous grant cannot silently authorize the new collector.

Live inspection also caught a stale-choice status label: the chooser described an old grant as active even though collection correctly stayed off. The chooser now shows an active status only for the current disclosure, and the stale-grant browser case guards that label as well as script loading.

Verification before push:

- Full unit suite: 11,300 passed, 44 existing skips; no failures.
- Web TypeScript and optimized production build passed.
- Full repository lint passed after replacing two untyped values in a scouting workflow test with its actual entry/history types.
- 17 dashboard browser cases passed against a dedicated loopback PostgreSQL database and production build, including desktop/phone resizing, save/reload, reset defaults, failures, board management, context and real work.
- Three Analytics browser cases passed using the installed Next SDK, real consent UI and a substituted collector. Declining and an obsolete grant load no collector. Opting in sends one URL-filtered page view; revocation blocks further collection; re-enabling resumes without duplicate script injection. These tests block service workers so the network substitution also applies to PWA pages.

Private local launch helpers, credentials, unrelated screenshots and bulky test artifacts are excluded from the commit. The production verification does not alter team membership, event selection or saved dashboard layouts. These results cover the workflows listed here, not every historical button and route.

Setup reference: [Vercel Web Analytics for Next.js](https://vercel.com/docs/analytics/quickstart).
