# Stock Home acceptance — October 2, 2026

Home is usable without opening the board editor. It presents real team tasks, scouting work, and the coming week's activities. A live upcoming match leads the overview with the existing match clock, bumper color, partners, opponents, and briefing/scouting destination.

## Changes

- Add a task, complete it, or open its details directly from Home. These operations use the existing authenticated `/api/todos` API and PostgreSQL records. Personal assignments lead the list, followed by overdue work and due dates.
- Fold stock task, personal-day, calendar, and coverage cards into the overview. Saved layouts remain intact; editing and explicitly pinned widgets retain their controls and placement.
- Replace large introductory and empty calendar panels with compact actionable content. Calendar events stay visible through their recorded end time.
- Refresh visible Home data every 15 seconds and immediately after local task changes, window focus, or reconnection. Hidden tabs skip requests. Per-widget request ordering prevents an older response from undoing a newer task update.

## Verification

- Optimized production build and TypeScript passed for the final application source. ESLint passed for changed client components and the workflow spec.
- Full unit run: 11,303 passed and 44 skipped. After the final match-priority change, all 83 focused dashboard/media checks passed, including its additional regression.
- Twenty unique browser workflows passed against the isolated production server. The final match-priority version reran all 15 Home/context/workspace workflows successfully. Earlier board-editor and persistence workflows also passed at desktop and phone sizes.
- Actual Better Auth sessions, authenticated APIs, and PostgreSQL verified task creation, completion, reopening from another client, and automatic refresh without a reload. A held older real snapshot did not resurrect a completed task.
- A newly inserted calendar event and future match appeared automatically. The match rendered above tasks at 1440px and 390px. These were disposable local fixtures, not production observations or invented application metrics.
- Home preserved a draft after a failed task write. Focus/reconnection requested a fresh full context. Scouting and calendar destinations retained team context.
- Scoped axe checks reported no violations at both widths, with no horizontal overflow. The board regression workflows covered save/reload, sizes, undo, explicit pins, and reset from Settings.

No production tasks, calendar events, memberships, or board layouts were changed during verification. Test traces and screenshots remain local. The full GitHub browser suite is separate from this acceptance run; previous main runs had failures and are not represented as passing here.
