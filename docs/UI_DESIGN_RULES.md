# UI design rules for Vantage

Research brief behind `docs/UI_SIMPLIFICATION_PLAN.md`. Grounded in Apple HIG, Tesla in-car UI (including
its documented criticisms), Microsoft Fluent 2 / Windows 11, the command-palette lineage (VS Code, Linear,
Raycast), and Base44. Rules marked [CI] are statically checkable — build them as lint rules or tests so
review is mechanical rather than a matter of taste.

Two of these already run in CI: R2 and R6 are enforced by `apps/web/lib/nav/route-coverage.test.ts`.

---

# Modern Product UI Principles — Redesign Brief for Vantage (dense multi-tool FRC app)

**Context this is written against:** `apps/web` currently has **227 top-level route directories / 270 `page.tsx` files**, organized into **6 hubs** (Competition, Team, Business, Build, AI, Logistics), a **4-app bottom island**, a `⌘K` surface, and per-hub "More tools" dumps. Users are high-school students on **phones** (stands, pits, cold hands, gloves, glare) and **shop laptops** (keyboard available, often shared). Every rule below is chosen because it survives both contexts.

---

## 1. Apple HIG — navigation, disclosure, targets, type

**Tab bar limits (the actual guidance, and the actual reason)**
- Apple recommends **3–5 tabs on iOS**; a few more on iPadOS/tvOS. Common practice caps at **6**.
- The reason is not aesthetic — it's the **overflow penalty**. When tabs exceed available horizontal space, the trailing tab becomes a **More tab**, and Apple's own text warns: *"The More tab makes it harder for people to reach and notice content on tabs that are hidden."* Overflow doesn't compress the IA; it creates a **second-class tier of features that users stop finding**. This is precisely the failure mode of a "More tools" dump.
- **Tab bars are for navigation only, never actions.** Actions belong in toolbars. Mixing the two makes users afraid to tap.
- **Keep the tab bar visible across the app.** Apple: *"If you hide the tab bar, people can forget which area of the app they're in."*
- **Never disable or hide tab bar buttons**, even when their content is empty — a nav bar whose items appear/disappear destroys spatial memory. (Directly relevant: Vantage's "empty/setup state" philosophy should render *inside* the destination, not remove the destination.)
- **Titles: one succinct term per tab.** A tab title's job is to describe the *type* of content.

**iOS 26 / Liquid Glass — how Apple bought back screen space without adding menus**
- `tabBarMinimizeBehavior` (e.g. `.onScrollDown`) lets the tab bar **collapse to just the active tab on scroll and re-expand on scroll up**. The bar floats over content rather than being glued to the edge.
- The design lesson: Apple's answer to "not enough room" is **temporal** (hide chrome while reading, restore on intent), never **structural** (add a tier of menus).
- A dedicated **search role tab** gets first-class placement — search is treated as a *destination*, not a widget.

**Progressive disclosure**
- Definition (NN/g): *"defers advanced or rarely used features to a secondary screen."* Two steps: show the most important options first, offer specialized options on request.
- Hard structural constraint: **do not exceed 2 disclosure levels.** Deeper hierarchies measurably harm usability.
- NN/g explicitly rejects a fixed percentage rule — placement should come from **frequency-of-use statistics + task analysis + observation**, not designer intuition. For Vantage this means: instrument route hits and let data, not the feature map, order the surfaces.

**One primary action per screen**
- Apple doesn't phrase it as a numbered rule, but enforces it structurally: one prominent/default button per alert and sheet, tab bars barred from carrying actions, and toolbars ordered by prominence. Microsoft states it explicitly (see §3), so use Fluent's phrasing as the enforceable version.

**Touch targets — three different numbers, don't confuse them**
| Source | Value | Status |
|---|---|---|
| Apple HIG (buttons/design tips) | **44 × 44 pt** hit region | The design target. *"a button needs a hit region of at least 44x44 pt — in visionOS, 60x60 pt"* |
| Apple HIG accessibility minimums table | **28 × 28 pt** (iOS/iPadOS/watchOS/visionOS), 20×20 macOS, 56×56 tvOS | Absolute floor, not a goal |
| WCAG 2.2 SC 2.5.8 (AA) | **24 × 24 CSS px**, with a spacing escape hatch (24px offset to adjacent targets) | Legal/compliance floor for web |
| WCAG 2.2 SC 2.5.5 (AAA) | **44 × 44 CSS px**, no spacing escape hatch | Matches Apple; the number to actually build to |
- visionOS spacing analogue: place button **centers at least 60 pt apart**. General HIG padding guidance: ~**12 pt** around bezeled elements, ~**24 pt** around visible edges.

**Typography**
- SF Pro **Text ≤19 pt**, SF Pro **Display ≥20 pt** (optical size switch at 20).
- Minimum text size **11 pt** iOS/iPadOS (10 macOS, 12 watchOS/visionOS, 23 tvOS).
- **Dynamic Type**: text must scale to at least **200%** (140% watchOS). Hardcoded font sizes break at accessibility sizes — this is the single most common failure.
- Contrast: **4.5:1** for text ≤17 pt; **3:1** for ≥18 pt or bold.

**How Apple handles deep feature sets without deep menus** — four mechanisms, all applicable here:
1. **Search as a top-level destination** (Settings has hundreds of panes; the answer is a search field at the top, not more tabs).
2. **Flatten-then-search**: keep a shallow hierarchy and let search cut across it.
3. **Contextual surfacing**: features appear in the context where they're relevant (share sheet, context menus) rather than in a global menu tree.
4. **Temporal chrome**: collapse navigation while the user reads, restore on intent.

---

## 2. Tesla in-car UI — single canvas, context-aware, and the well-documented backlash

**What Tesla actually does (the parts worth stealing)**
- **Single-screen operation.** One display absorbs climate, media, navigation, vehicle controls, and status. No mode switch, no separate instrument cluster on Model 3/Y.
- **Context-aware surfacing is the load-bearing idea.** The same canvas re-composes by vehicle state:
  - **Parked** — status area shows drive mode, estimated range, and an overhead car view with tappable trunk/charge-port buttons. Per design analysis: *"when you park, only the controls that are applicable to being parked show up."* The v12 UI makes the vehicle visualization dominate while parked.
  - **Charging** — a 3D visualization of the *specific* charger type connected (Supercharger / Destination / Wall / Mobile).
  - **Driving** — real-time Autopilot road visualization that **auto-zooms based on detected road type**.
- **Large hit areas and minimal chrome.** Persistent bottom strip for the few always-needed controls; everything else is summoned.
- **Why they collapsed physical controls into one canvas:** OTA updatability (the UI is a software product, not tooling-frozen hardware), manufacturing cost/part-count reduction, and a single design language across model years.

**The documented criticisms — this is the important half**
- **Vi Bilägare (Swedish) study**, 4 routine tasks (seat heater + cabin temp + defroster; change radio station; reset trip computer; dim instrument lighting + turn off center display), performed at 110 km/h:
  - 2005 Volvo V70 (physical controls): **10 s**
  - BMW iX: **30.4 s** (~3×)
  - MG Marvel R: **44.9 s** (worst)
  - Aggregate: drivers needed **4.6× more time** on touchscreen-first cars.
- **NHTSA visual-manual guidelines**: tasks should be completable with individual glances of **≤2 seconds** and **≤12 seconds cumulative** off-road glance time. The touchscreen results blow past this by 2–4×.
- **Euro NCAP, from 2026**: five functions must have **physical, tactile controls** to score five stars — **turn indicators, hazard lights, horn, windscreen wipers, emergency call**. Euro NCAP's framing: *"Digging through menus just to activate your wipers isn't progress – it's dangerous."* Distraction-related crashes in Europe rose **~20% since 2020**, coinciding with large-screen adoption.
- **Designers conceding the point** (Forbes, Mar 2026): Genesis' John Krsteski — *"We went down the path of a trend and we experienced it, but in reality is it really the right experience?"* — noting removing all physical controls caused confusion switching between vehicles. Lamborghini's Mitja Borkert said the industry *"went a little bit down the wrong road,"* stressing controls must be tested at speed, not in a design studio. VW Group, Citroën and Peugeot are restoring buttons; Tesla has the most ground to make up.
- **Tesla-specific**: routing driver alerts and even indicators through the central screen has been singled out for forcing eyes off the road.

**Translation to Vantage.** The pit and the stands are Tesla's cabin: **gloved hands, motion, glare, time pressure, and a hard deadline (the match clock)**. Two conclusions, and they pull in opposite directions — hold both:
- **Steal**: context-aware surfacing (event-day vs. build-season vs. off-season), one canvas per moment, huge hit areas, minimal chrome.
- **Reject**: burying time-critical functions behind navigation. The FRC analogue of "wipers and hazards" — **start a scouting entry, log a match note, pit checklist, next-match time** — must be reachable **without menu traversal**, ideally as persistent surfaces. Adopt a **12-second budget** for any competition-mode task (see Rule 9).

---

## 3. Microsoft Fluent 2 / Windows 11 — command surfaces, search-first, elevation, palettes

**Fluent 2 foundation:** principles of *Light, Depth, Motion, Material, Scale*, with **container-based responsive design** — the same card component works in a full-width layout, a split-view panel, and a Teams tab without media-query overrides. This is directly applicable to a hub/tab app that must render on a phone and a shop laptop.

**Primary action rule (the enforceable version)**
- *"Only use one primary button in a layout for the most important action."*
- *"If there are more than two buttons with equal priority, all buttons should have neutral backgrounds."*
- *"Always give the primary button action prominent placement, either on top of or to the left of other actions."* (Mirrored on the right in RTL.)
- Labels: **active voice, one verb (+ noun if it aids clarity), sentence case, no end punctuation.**
- Contrast: **4.5:1** button text, **3:1** icons vs background, across **all** interactive states.
- Semantic tokens: primary uses `colorBrandBackground` / `colorBrandForeground1` — i.e., "primary" is a **token**, not a hex value, which makes "how many primary buttons on this screen" statically checkable.

**Elevation — a discrete, named ramp (no ad-hoc shadows)**

| Token | Blur | Use |
|---|---|---|
| `$shadow2` | 2px | Edgeless cards, FAB pressed; ribbon/icons/hero buttons |
| `$shadow4` | 4px | Cards, grid items, list items |
| `$shadow8` | 8px | FABs, raised cards/app bars; **command bars**, command dropdowns, tooltips |
| `$shadow16` | 16px | Callouts, hover cards |
| `$shadow28` | 28px | Bottom sheet, side navigation, **raised tab bars** |
| `$shadow64` | 64px | Panels, pop-up dialogs |

Two ramps (low/high) and six steps total. Token name = blur px, so review is mechanical. Windows 11 layers this with **Mica** on title bars / nav pane headers over a solid `colorNeutralBackground1` content surface.

**Command surfaces:** the **floating command bar** aligns with the M365 pattern — consistent spacing, rounded corners, `$shadow8` elevation. Command bars are a distinct surface class from navigation; a menu button *does not* surface a primary action.

**Windows 11 Start menu — search-first, and the research behind it**
- Redesign research: **300+ Windows 11 users** in unmoderated studies, plus co-creation sessions, **eye-tracking heat maps**, and literal **scroll-wheel counting**.
- The dominant user request was blunt: **"Help me find my apps faster."**
- The fix was **flattening, not nesting**: all-apps promoted to the top level with **three views (categories / grid / A–Z)** to eliminate *"marathon scrolling."* Search bar pinned at the top.
- Design principle stated as *"shaving seconds off routine actions."* Recommendations surface on **temporal usage patterns** ("that app you always open around 2 pm").
- **Lesson for Vantage:** with 270 pages, the Start menu is the closest analogue in the industry. Their answer was **search + flat + 3 sort views + time-of-day prediction** — not a deeper tree.

**Command palette — the canonical implementations**
- **VS Code**: `Ctrl+Shift+P` / `⇧⌘P`. Docs: *"From here, you have access to **all** functionality within VS Code, including keyboard shortcuts for the most common operations."* Recently-used commands rank to the top; typing `?` lists available modes. Note the dual-binding: `Ctrl+P` for *files* (objects), `Ctrl+Shift+P` for *commands* (verbs) — one palette, two entry modes.
- **Linear**: `⌘K` / `Ctrl+K` opens the command menu giving *access to every action in Linear by name*. Linear's stated design philosophy is that **every common action is reachable in two keystrokes or fewer**, and the palette is the memory-free fallback: if you forget any other shortcut, open `⌘K` and type what you want.
- **Raycast**: `⌘Space` root search for *objects/commands*; `⌘K` **Action Panel** for every secondary action on the selected item. Two crucial details: **each action displays its keyboard shortcut on the right** (the palette teaches shortcuts, converting novices into keyboard users over time), and **aliases + global hotkeys** let power users bypass the palette entirely for daily actions.
- `⌘K` is now the de facto standard: Linear, Vercel, GitHub, Slack, Raycast.
- Implementation anatomy: keyboard-shortcut hook → **fuzzy-matched** command list → arrow-key selection with **focus trapping** for accessibility → portal-rendered overlay.

---

## 4. Base44 (Wix AI app builder) — why it reads as simple

**What the UI actually is**
- **Builder Chat is the primary surface** — a conversational panel described as acting as "your personal software engineer." You describe the app in plain English; it generates UI, data model, backend, and auth.
- **Three interaction modes, not three screens**: (1) default messaging mode that executes prompts, (2) a **visual editor** for direct manipulation of fonts/colors/spacing/position, (3) a **discussion mode** for planning *before* any edit is made.
- **One canvas.** The "Canvas" view is explicitly *"See every page at once. Leave notes, sketch ideas, and send instructions straight to AI — all on one board."*
- **Global controls collapsed to one place**: *"Set colors and fonts for your entire app from one place"* — no per-page theming surface.
- **Very little chrome**: chat panel + live preview. Publishing is one click with hosting/domain built in.

**Why it feels simple — the transferable mechanics**
1. **Intent-first, not navigation-first.** The user states a goal in natural language; the system decides which "tool" that maps to. The tool inventory is never rendered as a menu — this is why an objectively large feature surface reads as small.
2. **One canvas, multiple modes.** Modes swap the *interaction verb* on a stable spatial layout rather than navigating to different places. Nothing moves; only what you can do changes.
3. **Direct manipulation as the escape hatch from chat.** When language is a clumsy way to say "6px more padding," the visual editor is right there — and critically, **visual edits don't consume message credits**, so the cheap path is also the direct path.
4. **Progressive commitment.** Discussion mode lets you plan without mutating state — a deliberate gate before irreversible action.
5. **Global-scope controls.** Anything that should be consistent is edited in exactly one location.

**Direct read for Vantage:** the AI chat already in the product (`/ai`) plus `⌘K` should be treated as **the same intent surface**, not two features. A student typing "log a match note for our next match" should not need to know whether that's a page, a command, or an AI action.

---

## 5. Synthesis — 16 concrete, testable rules

Each rule states a number, an implementation, and a check. Rules marked **[CI]** are statically enforceable — build them as lint rules or a `npm run ui:audit` script so review is mechanical, not aesthetic.

---

**R1 — Maximum 5 primary navigation destinations, globally. [CI]**
The bottom island / top nav exposes **≤5** destinations on every viewport, phone through desktop. No "More" item is permitted in that set. Current state is a 4-app island — keep 4, cap at 5.
*Check:* assert the rendered nav item count ≤5 in a snapshot test at 375px, 768px, and 1280px widths.
*Why:* Apple 3–5 tabs; the More tab demonstrably hides content from users.

**R2 — No feature may be reachable *only* via a "More tools" list. [CI]**
Every route must have **≥2** entry paths: (a) at least one contextual/hub link *and* (b) a command-palette entry. A "More tools" grid may exist as a browsable directory but must never be a feature's sole door.
*Check:* enumerate `app/**/page.tsx` (270 today); fail the build if any non-`/api`, non-`/admin` route lacks a registered palette command. Emit the orphan list.
*Why:* this is the "More tab" failure mode Apple names explicitly, at 200× the scale.

**R3 — Navigation depth ≤2 disclosure levels from a hub to any leaf tool. [CI]**
`hub → tab → tool`. Never `hub → tab → subtab → tool`. If a tool needs a third level, it becomes its own destination reachable by search, not a deeper node.
*Check:* validate the route/feature-map manifest; assert max depth 2.
*Why:* NN/g — beyond 2 disclosure levels usability degrades.

**R4 — Exactly one primary (brand-token) button per screen. [CI]**
Zero is allowed (pure-read screens). Two is a bug. If ≥3 actions have equal priority, **all** render neutral/outline. Primary sits **above or left of** secondary actions.
*Check:* lint rule — at most one `<Button appearance="primary">` (or brand-token equivalent) per page component tree; runtime `data-primary-action` counter assertion in E2E.
*Why:* Fluent 2, stated verbatim.

**R5 — Minimum 44 × 44 CSS px interactive target; 48 px in competition mode; ≥8 px separation. [CI]**
44px is the floor everywhere (WCAG 2.5.5 AAA / Apple HIG). Any surface rendered under event-day/pit context raises to **48 × 48** with **≥12 px** gaps — gloves, cold hands, motion.
*Check:* Playwright pass over key routes measuring `getBoundingClientRect()` of every focusable element; fail below threshold. Axe-core for the WCAG 2.5.8 baseline.

**R6 — Every action reachable in ≤2 keystrokes via the command palette.**
`⌘K` / `Ctrl+K` opens; **≤2 further keystrokes** must surface the target in the top 5 results for its canonical name. Bind `⌘K` and `Ctrl+K` globally; also accept `Ctrl+Shift+P` as an alias for laptop users with editor muscle memory.
*Check:* a data-driven test iterating the command registry — type the first 2 chars of each command's canonical name, assert it ranks top-5. Fuzzy matching + recency weighting required.
*Why:* Linear's explicit two-keystroke standard; VS Code's "all functionality" promise.

**R7 — The palette shows keyboard shortcuts inline, and surfaces 5 recents on open. [CI]**
Empty-state palette = **5 most-recent + 3 context-suggested** commands, never a blank box or an alphabetical dump of 270 items. Every row with a bound shortcut renders it right-aligned.
*Why:* Raycast's shortcut-on-the-right is the mechanism that converts novices into keyboard users; VS Code ranks recents first.

**R8 — Palette result list capped at 8 visible rows, grouped by ≤4 categories.**
Beyond 8 rows the user is scanning, not selecting. Group headers: Go to / Do / Ask AI / Recent.
*Check:* component test asserting rendered row count ≤8 for any query.

**R9 — Competition-mode tasks complete in ≤12 seconds and ≤5 taps.**
Every task designated `competition-critical` (start scouting entry, log match note, open pit checklist, see next match time, mark robot ready) must be completable within **12 s** and **≤5 taps** from cold app open. This is the NHTSA cumulative-glance budget applied to a stands/pit environment.
*Check:* timed Playwright scripts on a throttled mobile profile, asserted in CI. Publish the per-task table; a regression is a failing build.
*Why:* Vi Bilägare showed menu-buried tasks hitting 30–45 s; NHTSA caps cumulative off-task glance at 12 s.

**R10 — Five competition-critical actions get persistent, always-visible surfaces — never menu-buried.**
Direct Euro NCAP analogue (indicators/hazards/horn/wipers/eCall). Pick exactly **5** for Vantage — recommend: **next match time, start scout entry, log note, pit checklist, alert team**. These live on a persistent bar in competition context, at R5's 48px sizing.
*Check:* E2E assertion that all 5 are visible and hit-testable at 375×667 without scrolling, on every competition-context route.

**R11 — Context surfaces features; context never hides navigation. [CI]**
Adopt Tesla's contextual composition (event-day / build-season / off-season / charging-analogue states change *what is offered*), but the ≤5 primary destinations from R1 **never change, reorder, or disable** across contexts.
*Check:* snapshot nav item IDs and order across all context states; assert identical.
*Why:* Apple — don't disable or hide tab bar buttons; Tesla's context-awareness is good, its removal of stable controls is the documented failure.

**R12 — Chrome may collapse on scroll; it may never be permanently removed.**
Implement `.onScrollDown` minimize behavior: nav collapses to the active destination while scrolling down, restores on scroll up or on any upward intent. Restoration must take **≤1 gesture**.
*Why:* iOS 26 `tabBarMinimizeBehavior` — this is how Apple reclaims space without adding menu depth.

**R13 — Search is a first-class destination with a dedicated slot, and returns results in ≤300 ms.**
Search occupies its own role in the nav set (Apple's search-role tab) or a fixed top-of-hub field (Windows 11 Start). It indexes **routes, tools, people, matches, and documents** in one ranked list. First keystroke to first result: **≤300 ms** p95, client-indexed.
*Check:* performance assertion in CI; index-coverage test asserting all 270 routes are indexed.
*Why:* Start menu research — "help me find my apps faster" was the #1 request across 300+ users; the answer was search + flattening.

**R14 — Any tool list longer than 12 items ships ≥2 sort/filter views. [CI]**
Category, A–Z, and Recently-used. No "marathon scrolling" through an unsorted grid.
*Check:* component contract — any `<ToolGrid>` with >12 children must receive a `views` prop with ≥2 entries.
*Why:* Windows 11 shipped exactly three views for precisely this problem.

**R15 — Elevation drawn from a 6-step token ramp; zero ad-hoc shadows. [CI]**
`shadow2 / 4 / 8 / 16 / 28 / 64`. Cards = `shadow4`. Command bar / palette = `shadow8`. Bottom island = `shadow28`. Dialogs = `shadow64`.
*Check:* stylelint rule banning literal `box-shadow` values outside the token set. Same for color: ban raw hex in component files; brand-token usage is what makes R4 statically checkable.

**R16 — Type scale of 7 steps, no hardcoded sizes, legible at 200% zoom. [CI]**
Use `rem`-based tokens only. Body text **≥16 px** on mobile (the 11 pt HIG floor is an absolute minimum, not a target — students read this in sunlight). Optical switch analogous to SF Text/Display at the **20 px** boundary. Contrast **4.5:1** below 20px, **3:1** at ≥20px or bold, verified in **all** interactive states.
*Check:* stylelint ban on `px` font-size in components; axe-core contrast pass; a 200%-zoom Playwright snapshot asserting no clipped or overlapping text on the top 20 routes.

**R17 — One canvas per moment: ≤1 primary content region + ≤1 assistive panel.**
Base44's chat+preview split. No screen presents two co-equal workspaces competing for attention. The AI/chat panel is the assistive rail on every hub, not a separate destination — same surface, different mode.
*Check:* design review checklist item; layout components expose exactly one `<PrimaryRegion>` slot.

**R18 — A destructive or state-mutating action always has a non-mutating inspect path first.**
Base44's discussion mode. Any action that writes org-scoped data (publishing a form, sending an invite, finalizing a pick list, committing a budget line) offers preview/plan before commit.
*Check:* route-level audit — every `POST`/`PATCH`-triggering primary CTA has a corresponding preview state in its component; enumerate exceptions explicitly with justification.

---

### Priority ordering for implementation

1. **R2 + R6 + R13** (palette coverage + search) — highest leverage. With 270 pages, search/palette completeness matters more than any visual change; it converts the entire surface from "navigable" to "addressable."
2. **R5 + R9 + R10** (targets, 12 s budget, persistent critical actions) — the competition-context safety story; these are the rules that make the phone experience work in the stands.
3. **R1 + R3 + R11 + R14** (structural caps) — prevents regression back into a tool dump.
4. **R4 + R15 + R16** (token enforcement) — cheap to enforce once tokens exist, and makes all subsequent review mechanical.

**Two rules that conflict on purpose:** R2 (everything reachable) and R1/R14 (nothing dumped). They are resolved by **search and the palette carrying the long tail**, while visible navigation carries only the ≤5 + hub tabs. That is the same resolution Apple (Settings search), Microsoft (Start search), and Linear (`⌘K`) all reached independently.

---

## Sources

- [Tab bars — Apple Human Interface Guidelines](https://developer.apple.com/design/human-interface-guidelines/tab-bars) (content via [apple-dev-mcp mirror](https://raw.githubusercontent.com/tmaasen/apple-dev-mcp/main/content/universal/tab-bars.md))
- [Accessibility — Apple Human Interface Guidelines](https://developer.apple.com/design/human-interface-guidelines/accessibility) (via [mirror](https://raw.githubusercontent.com/tmaasen/apple-dev-mcp/main/content/universal/accessibility.md))
- [Layout — Apple Human Interface Guidelines](https://developer.apple.com/design/human-interface-guidelines/layout) (via [mirror](https://raw.githubusercontent.com/tmaasen/apple-dev-mcp/main/content/universal/layout.md))
- [Apple Developer — Design Tips (44pt × 44pt controls)](https://developer.apple.com/design/tips)
- [Exploring tab bars on iOS 26 with Liquid Glass — Donny Wals](https://www.donnywals.com/exploring-tab-bars-on-ios-26-with-liquid-glass/)
- [Liquid Glass Tab Bar in SwiftUI (iOS 26): behavior, Search, and customization](https://jorgemrht.dev/2025/09/18/liquid-glass-tab-bar)
- [Making the tab bar collapse while scrolling — Create with Swift](https://www.createwithswift.com/making-the-tab-bar-collapse-while-scrolling/)
- [Progressive Disclosure — Nielsen Norman Group](https://www.nngroup.com/articles/progressive-disclosure/)
- [WCAG 2.2 SC 2.5.8 Target Size (Minimum) — wcag.com](https://www.wcag.com/developers/2-5-8-target-size-minimum-level-aa/)
- [Understanding SC 2.5.8 Target Size (Minimum) — DigitalA11Y](https://www.digitala11y.com/understanding-sc-2-5-8-target-size-minimum/)
- [All accessible touch target sizes — LogRocket](https://blog.logrocket.com/ux-design/all-accessible-touch-target-sizes/)
- [Swedish Test Offers Compelling Evidence That Buttons Are Less Distracting Than Touchscreens — The Autopian](https://www.theautopian.com/swedish-test-offers-compelling-evidence-that-buttons-are-less-distracting-than-touchscreen-infotainment-systems/comment-page-1/)
- [Study Shows Touchscreens In Cars Are More Distracting Than Physical Buttons — CarThrottle](https://www.carthrottle.com/news/well-duh-study-shows-touchscreens-cars-are-more-distracting-physical-buttons)
- [Visual-Manual NHTSA Driver Distraction Guidelines (2s / 12s) — Federal Register](https://www.federalregister.gov/documents/2013/04/26/2013-09883/visual-manual-nhtsa-driver-distraction-guidelines-for-in-vehicle-electronic-devices)
- [NHTSA Distraction Guidelines (PDF)](https://www.nhtsa.gov/sites/nhtsa.gov/files/distraction_npfg-02162012.pdf)
- [Automakers Went A Touch Too Far With Screens, Designers Admit — Forbes](https://www.forbes.com/sites/michaeltaylor/2026/03/05/automakers-went-a-touch-too-far-with-screens-designers-admit/)
- [Euro NCAP To Penalize Touchscreens In Cars From 2026 — TechStory](https://techstory.in/euro-ncap-to-penalize-touchscreens-in-cars-from-2026/)
- [Europe and China push back against touchscreen car interiors — AutoNext](https://www.autonext.co/news/europe-and-china-push-back-against-touchscreen-overload-in-cars-the-return-of-physical-buttons)
- [Tesla Model Y Owner's Manual — Touchscreen / status area](https://www.tesla.com/ownersmanual/modely/en_us/GUID-80B80D48-E3A9-4857-864B-F4CC9B56FD7E.html)
- [Tesla Model S Owner's Manual — Instrument panel / driving visualization](https://www.tesla.com/ownersmanual/models/en_us/GUID-29A7E205-A689-41D1-B69C-3AE821CB70E7.html)
- [First Look at Tesla's V12 User Interface — Not a Tesla App](https://www.notateslaapp.com/news/1988/inside-teslas-new-v12-user-interface)
- [Tesla update 2025.38 displays charger type — Tesla Oracle](https://www.teslaoracle.com/2025/10/20/tesla-update-2025-38-ui-displays-the-type-of-charger-connected-to-the-vehicle/)
- [Fluent 2 Design System — Home](https://fluent2.microsoft.design/)
- [Fluent 2 — Elevation](https://fluent2.microsoft.design/elevation)
- [Fluent 2 — React Button usage](https://fluent2.microsoft.design/components/web/react/core/button/usage)
- [Fluent 2 — Card usage](https://fluent2.microsoft.design/components/web/react/core/card/usage)
- [Fluent 2 — Windows components overview](https://fluent2.microsoft.design/components/windows)
- [Start, fresh — Redesigning the Windows Start menu — Microsoft Design](https://microsoft.design/articles/start-fresh-redesigning-windows-start-menu/)
- [Microsoft revamps the Start menu in Windows 11 — Windows Central](https://www.windowscentral.com/microsoft/windows-11/whats-in-the-new-start-menu-on-windows-11-for-versions-25h2-and-24h2)
- [Modern, refreshed look for model-driven apps (floating command bar) — Microsoft Learn](https://learn.microsoft.com/en-us/power-apps/user/modern-fluent-design)
- [VS Code — User Interface / Command Palette](https://code.visualstudio.com/docs/getstarted/userinterface)
- [Command Palette | UX Patterns — Alicja Suska, Bootcamp](https://medium.com/design-bootcamp/command-palette-ux-patterns-1-d6b6e68f30c1)
- [Command Palette Pattern — UX Patterns for Developers](https://uxpatterns.dev/patterns/advanced/command-palette)
- [Build a Command Palette: Cmd+K Like Linear and Vercel](https://www.techinterview.org/post/3233475212/build-command-palette-cmd-k/)
- [Linear Keyboard Shortcuts — complete cheat sheet](https://fastshortcuts.com/shortcuts/linear/)
- [Raycast Manual — Action Panel](https://manual.raycast.com/action-panel)
- [Raycast Manual — Keyboard Shortcuts](https://manual.raycast.com/keyboard-shortcuts)
- [Raycast Manual — Command Aliases & Hotkeys](https://manual.raycast.com/command-aliases-and-hotkeys)
- [Base44 — official site](https://base44.com/)
- [Base44 Review 2026: Honest Test & Verdict — No Code MBA](https://www.nocode.mba/articles/base44-review)
- [Base44 Review for 2026: Tested & Compared — Website Builder Expert](https://www.websitebuilderexpert.com/vibe-coding/base44-review/)
- [Base44 Review (2026): A Deep Dive — Willo](https://www.willo.ai/blog/base44-review)
- [Wix acquires Base44 — Wix Press Room](https://www.wix.com/press-room/home/post/wix-further-expands-into-vibe-coding-with-acquisition-of-base44-a-hyper-growth-startup-that-simplif)
