# Competitive notes — what Vantage will not repeat

*For product decisions: what other FRC tools do well, where they fall down, and the mistakes Vantage avoids. Last updated 2026-09-10.*

Verified 2026-09-10 against live sites and current GitHub READMEs. This is the brief for Tasks 2–4 (design system, UI pass, Home widgets). Every “do not repeat” line points at a Vantage surface that must answer it.

Sources opened this session:

- [The Blue Alliance](https://www.thebluealliance.com/) (live: Gateway Robotics Challenge and Kettering Kickoff listed for 11–13 Sep 2026)
- [TBA About](https://www.thebluealliance.com/about)
- [Chief Delphi: TBA 2026 site updates](https://www.chiefdelphi.com/t/the-blue-alliance-2026-site-updates-features/515744)
- [TBA Android 11.0.0](https://github.com/the-blue-alliance/the-blue-alliance-android/releases/tag/v11.0.0)
- [TBA PWA scouting tab](https://github.com/the-blue-alliance/the-blue-alliance/commit/bce6a1d)
- [Statbotics](https://www.statbotics.io/) and [statbotics/statbotics](https://github.com/statbotics/statbotics)
- [Statbotics 2026 season thread](https://www.chiefdelphi.com/t/statbotics-2026-season/515311)
- [FRC2713/QRScout](https://github.com/FRC2713/QRScout) (live app: https://frc2713.github.io/QRScout/)
- [PWNAGERobotics/ScoutingPASS](https://github.com/PWNAGERobotics/ScoutingPASS) and [2026 REBUILT config announcement](https://www.chiefdelphi.com/t/scoutingpass-rebuilt-configuration-is-live/510808)
- [FRC1792 scouting whitepaper](https://github.com/FRC1792/FRC1792.github.io/blob/main/docs/TECHNICAL_WHITEPAPER.md) (Sheets-backed stack)

---

## 1. The Blue Alliance (web + apps)

**What it is today.** The public record of FRC: teams, events, match results, videos, rankings, district points, CAD hosting, myTBA favorites. 501(c)(3). 2026 shipped a PWA rewrite plus Android 11 (Compose): dark mode, push for favorited teams/events, home-screen widget for next match, app shortcuts, restored OPR/DPR/CCWM on Team@Event, a scouting tab that **exports CSV** (team list, schedule, component OPRs), 2026 score breakdown, and a score-by-shift chart.

**What students like.** Fast, free, always there. Next-match widget. Videos. One URL everyone already knows. Live event pages during a regional.

**Where it fails a team.**

- It is a **reference**, not an operations platform. No shop calendar, no CAD vault that is yours, no dues, no pit checklist you own.
- The new scouting tab exports *public* data into a spreadsheet. It does not collect *your* scout entries, and it does not work in a Faraday-cage venue without the site.
- Android 11.0 shipped missing scouting detail that the old app had; CD users went back to the website until 11.2.1 restored stats. Lesson: a rewrite that drops the thing people used yesterday feels like a broken product.
- myTBA historically logged people out; 2026 claims that is fixed. Account friction still exists (Firebase + Google).

**Mistakes Vantage must not repeat**

| Mistake | Vantage answer |
|---|---|
| Treat TBA as “the app” instead of the public cache | Team profile / dossier (`/team/profile`) + `matches_ref` / `team_event_metrics`. Never scrape TBA in parallel; one ingest worker. |
| Ship a rewrite that hides the next match | Home widget **Next match prediction** + island **Compete**. The next match is never more than one tap away. |
| Export-only “scouting” that dumps to CSV and walks away | `/scouting` with offline outbox (`scout_sync_receipts`), not a QR-to-Sheets sidecar. |
| Invent scores when TBA has none | Empty state: “No scored matches yet — TBA has not posted this match.” Never a placeholder %. |

---

## 2. Statbotics

**What it is today.** EPA (Expected Points Added) in point units, split auto/teleop/endgame, live match predictions, event simulation, REST + Python APIs, no key required (rate-limit yourself). 2026: three RP components, Israel mean-reversion special case, **~80% match-winner accuracy** claimed on CD for 2026 through late April. Open source. MCP server exists for AI tools.

**What students like.** A number they can argue with in the pit. Win probability on a match page. Bubble charts. “Is 254 actually 4 points better in endgame.”

**Where it fails a team.**

- EPA is **not scouted**. It cannot see who scored in auto vs a human player. CD 2026 thread: teleop EPA includes hub endgame points unless you know to subtract — easy to misread.
- No offline pit mode. No “this alliance, this auto, this defender” plan the drive team can read in 20 seconds.
- No team-private scouting blend. A team that has 40 matches of cycle counts cannot put them *into* the public model from the site.

**Mistakes Vantage must not repeat**

| Mistake | Vantage answer |
|---|---|
| Show a win % with no error band and no drivers | Task 8: every prediction shows expected error and the top three drivers in plain words. Hide the widget when inputs are missing. |
| Silently merge scouted cycles into EPA | Private pEPA (`/api/org/analytics/private-epa`) is labeled as this team’s scouting, never as Statbotics. Video analysis (Task 9) is “from video (confidence 0.7)” until a human confirms. |
| Chase winner-accuracy and call it ±3 points | Winner accuracy ≠ score MAE. Backtest prints MAE, RMSE, within-±3, within-±5. If ±3 is unreachable on public data, say so and show where scouting moves it. (`docs/PREDICTION_RESULTS.md`) |
| Let AI invent EPA | `loadOrgSessionFacts` + honesty rules in `chat-system-prompt.ts`. No number without a citation. |

---

## 3. QRScout (FRC 2713)

**What it is today.** A GitHub Pages web app. Load once, fill a configurable form, get a **QR code** of tab-separated values, scan into Excel/Sheets. PWA. Config via uploaded `config.json` or a GitHub URL. ~30 stars, 158 forks — the fork count is the product: every team copies it.

**What students like.** No accounts. No internet after the first load. Venue-as-Faraday-cage is the design constraint. A new scout can be handed a tablet.

**Where it fails a team.**

- **The spreadsheet is the database.** Analysis, alliance selection, and “what did we say about 254” live in a file someone owns on a laptop. When that laptop dies, the season dies.
- Onboarding a new member still means: GitHub Pages URL, config JSON, a scanner, a sheet with the right columns, and a human who knows which tab is this week’s event.
- No photos/files, no chat, no CAD, no money. It solves one hour of Saturday and none of the other 5,000 hours.

**Mistakes Vantage must not repeat**

| Mistake | Vantage answer |
|---|---|
| Offline that looks like a different app | Task 5: same screens, last snapshot, quiet “offline — showing what you had at 14:02”. Never a dead Retry. |
| QR as the only sync | Keep QR as a *fallback* handoff (`/scout-p2p-relay`) but the default is the outbox that syncs when signal returns. |
| Config JSON that only the programming lead understands | Scouting forms builder (`/scouting/forms`) with a pit default. A 15-year-old should add “climbed?” without editing JSON. |
| Data living on one mentor’s Drive | Drive (`/files`) + RLS. The team’s data is the team’s. |

---

## 4. Scouting PASS (PWNAGE 2451)

**What it is today.** Five swipeable pages (Pre / Auto / Teleop / Endgame / Post), JSON config per year, QR on the last page, GitHub Pages. 2026 REBUILT config shipped days after kickoff: field image, +5/+10 increment buttons, heat-map Excel example. Fuel scoring at 5–10 units/second is acknowledged as **uncountable by hand** — they recommend relative contribution applied to the official TBA total.

**What students like.** Phone-native swipe. Yearly config in days, not weeks. Fork-and-host. Pit scouting sibling page.

**Where it fails a team.**

- Still QR → spreadsheet. Same ownership and onboarding tax as QRScout.
- “REBUILT Configuration is Live” is engineering-event copy. A 15-year-old should not have to know the game’s marketing name to open the app. (Vantage copy-lint exists because we shipped the same sin.)
- Relative-fuel estimation is honest; silently writing it as a cycle count would not be.

**Mistakes Vantage must not repeat**

| Mistake | Vantage answer |
|---|---|
| Year-name in the chrome (“REBUILT 2026 — published pack”) | Task 3: screens say what to *do*. Game year lives in help, not in the overline. |
| Pretend a human counted 400 fuel | Empty or “share of alliance total from TBA” with the method named. Never a fake cycle count. |
| Five pages *plus* a hub tab bar *plus* a tool strip | R3: island → section tabs → tool strip. Nothing adds a fourth layer. |

---

## 5. The stack most teams actually run

**Discord + Google Sheets + Onshape + GitHub + a scouting app (PASS/QRScout/SPOT/Forms).**

Verified pattern from CD 2026 (1792 left Google Forms because dropdowns were too slow, then built a custom app that **still writes to Sheets** because “Sheets as the backbone was non-negotiable”). SPOT (3061) exists specifically because first-run TBA keys + a hosted DB are too hard.

**What students like.** Discord is already where the team talks. Sheets is already where the mentor “does data.” Onshape is already CAD class. GitHub is already robot code. No one had to “adopt a platform.”

**Where it fails — this is the whole product thesis.**

- **Fifty accounts.** A rookie needs: Discord, Google (school vs personal), Onshape, GitHub, TBA (sometimes), the scouting PWA, maybe Slack, maybe a second sheet for money. That is the headache the owner named.
- **Onboarding is folklore.** “Ask last year’s programming lead for the sheet.” When they graduate, the bus factor is 1.
- **Offline is someone else’s problem.** Discord and Sheets die in the venue. The scouting PWA works; nothing else does. Drive-team briefing is a screenshot.
- **Money and CAD and code and scouting never meet.** Alliance selection does not see that the climber is in the machine shop. The budget does not see the part request from CAD.
- **Data ownership is accidental.** A school-managed Google account locks the sheet over the summer. A mentor’s personal Drive is not the team’s.

**Mistakes Vantage must not repeat**

| Mistake | Vantage answer |
|---|---|
| A connector that 500s when the key is missing | `/connectors`: every card names the env var and the callback URL with credentials *unset*. Connect is never a reload loop. (Task 10, already on main — keep it honest.) |
| A new destination for “AI” | Ask AI is a **control**, not a hub. Learning tracks (`/cad-learn`, `/dev-setup`) are the front door. |
| Widgets that invent a budget remaining | Hidden entirely when there is no `manage_budget` row. Empty = one line + one action. |
| Three-deep menus to find Chat | Island **Team** → Chat. Calendar, Files, Hours on the same hub. |
| Dark mode as inverted light | Task 2: designed dark (surfaces step up, rims not drop shadows). |
| Desktop as a second UI | Electron loads the hosted app. No desktop-only chrome. Fusion relay stays local. |

---

## 6. Design implications for Tasks 2–4 (non-negotiable)

From the failures above, not from taste:

1. **One visual system.** Competing token sets (`--soft-*` / `--app-*` / `--m-*`) are how dark mode and two “secondary” buttons happen. Canonical names live in `apps/web/app/system.css`.
2. **Next match is a widget, not a hunt.** Student default Home: next match, my day, learn, tasks, files, chat. Mentor default: next match, duties, budget/part requests, attendance, outreach, acknowledgements.
3. **Offline is the same UI.** QRScout won because the venue is a Faraday cage. Vantage must not send people to `/offline` as a different product.
4. **No engineering vocabulary.** “REBUILT”, “DEMO”, “Soft-UI”, “org-scoped” are how we sounded like a GitHub README. Copy-lint stays red on new sins.
5. **Do not become TBA or Statbotics.** We *read* them. We do not replace the public record. We add the shop week, the pit, the money, and the “why” on a prediction.

---

## 7. What we will not build

- A TBA clone (schedules, videos, rankings as a public site).
- A Statbotics clone (public EPA leaderboard).
- A QR-only scouting app with no account.
- A Discord bot as the system of record.
- A Freebuff session scraper or extension (ToS, 2026-09-02).
- Demo numbers “so the widgets look full.”
