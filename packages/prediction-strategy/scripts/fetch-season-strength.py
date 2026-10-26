#!/usr/bin/env python3
"""Public team-strength priors from The Blue Alliance event pages.

Statbotics' REST API was HTTP 500 on this fetch, so each event page is the
source. The page lists both alliances and both scoreboard totals. It does not
list auto, teleop, or fouls, so these ratings are a total only.

Championship keys already in the 2026 category fixture are skipped. A full-event
rating for one of those events would include matches that had not been played
yet at prediction time.
"""

from __future__ import annotations

import json
import os
import re
import time
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import date

UA = "Mozilla/5.0 (compatible; vantage-research/1.0; +https://github.com/sahil-patel-2011/vantage-frc)"
CACHE = os.environ.get("TBA_CACHE", "/tmp/tba-cache")
OUT = os.path.join(os.path.dirname(__file__), "..", "test", "fixtures", "season-strength.json")
FETCHED = date.today().isoformat()

# Already replayed match by match. Do not bake their full-event ratings in.
SKIP_EVENTS = {
    "2026gagr",
    "2026arc",
    "2026cur",
    "2026dal",
    "2026gal",
    "2026hop",
    "2026joh",
    "2026mil",
    "2026new",
    "2026cmptx",
}

ROW_RE = re.compile(r'<tr class="visible-lg">(.*?)</tr>', re.S)
TEAM_RE = re.compile(r'data-team="(frc\d+)"')
SCORE_RE = re.compile(r'class="(?:red|blue)Score".*?<span[^>]*>\s*(-?\d+(?:\.\d+)?)\s*</span>', re.S)
KEY_RE = re.compile(r'href="/match/([a-z0-9_]+)"')
# One table row. A page-wide search pairs an event with the next row's dates
# (Einstein has a start and no end, which is how 2024cmptx once got February).
INDEX_ROW_RE = re.compile(
    r'<tr itemscope itemtype="http://data-vocabulary.org/Event">(.*?)</tr>',
    re.S,
)
INDEX_KEY_RE = re.compile(r'href="/event/(20\d{2}[a-z0-9]+)"')
INDEX_NAME_RE = re.compile(r'title="([^"]*)"')
INDEX_START_RE = re.compile(r'itemprop="startDate" datetime="(\d{4}-\d{2}-\d{2})')
INDEX_END_RE = re.compile(r'itemprop="endDate" datetime="(\d{4}-\d{2}-\d{2})')


def fetch(url: str, dest: str, tries: int = 4) -> str:
    os.makedirs(os.path.dirname(dest), exist_ok=True)
    if os.path.exists(dest) and os.path.getsize(dest) > 1500:
        return dest
    last: Exception | None = None
    for i in range(tries):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": UA})
            with urllib.request.urlopen(req, timeout=40) as resp:
                data = resp.read()
            if len(data) < 1500 or b"Server Error" in data[:500]:
                raise RuntimeError(f"bad body {len(data)}")
            with open(dest, "wb") as handle:
                handle.write(data)
            return dest
        except Exception as exc:  # noqa: BLE001
            last = exc
            time.sleep(0.4 * (i + 1))
    raise RuntimeError(f"{url} failed: {last}")


def parse_index(year: int) -> list[dict]:
    path = fetch(
        f"https://www.thebluealliance.com/events/{year}",
        os.path.join(CACHE, f"events-{year}.html"),
    )
    html = open(path, errors="ignore").read()
    found: dict[str, dict] = {}
    for chunk in INDEX_ROW_RE.findall(html):
        key_match = INDEX_KEY_RE.search(chunk)
        start_match = INDEX_START_RE.search(chunk)
        if not key_match or not start_match:
            continue
        key = key_match.group(1)
        if not key.startswith(str(year)) or key in SKIP_EVENTS:
            continue
        start = start_match.group(1)
        end_match = INDEX_END_RE.search(chunk)
        end = end_match.group(1) if end_match else start
        if end < start:
            end = start
        name_match = INDEX_NAME_RE.search(chunk)
        found[key] = {
            "key": key,
            "name": name_match.group(1) if name_match else key,
            "start": start,
            "end": end,
            "year": year,
        }
    return list(found.values())


def parse_matches(html: str) -> list[dict]:
    matches = []
    seen = set()
    for chunk in ROW_RE.findall(html):
        key_match = KEY_RE.search(chunk)
        if not key_match:
            continue
        key = key_match.group(1)
        if key in seen:
            continue
        teams = TEAM_RE.findall(chunk)
        scores = [float(value) for value in SCORE_RE.findall(chunk)]
        if len(teams) < 6 or len(scores) < 2:
            continue
        if scores[0] < 0 or scores[1] < 0:
            continue
        seen.add(key)
        level = "qm"
        if "_sf" in key:
            level = "sf"
        elif "_f" in key:
            level = "f"
        elif "_qf" in key:
            level = "qf"
        elif "_ef" in key:
            level = "ef"
        matches.append(
            {
                "key": key,
                "level": level,
                "red": teams[:3],
                "blue": teams[3:6],
                "redScore": scores[0],
                "blueScore": scores[1],
            }
        )
    return matches


def solve(alliances: list[tuple[list[str], float]], ridge: float = 2.0) -> dict[str, float]:
    played: dict[str, int] = {}
    for teams, _score in alliances:
        for team in teams:
            played[team] = played.get(team, 0) + 1
    teams = sorted(played)
    index = {team: i for i, team in enumerate(teams)}
    n = len(teams)
    if n == 0:
        return {}
    ata = [[0.0] * n for _ in range(n)]
    atb = [0.0] * n
    total = 0.0
    slots = 0.0
    for members, score in alliances:
        ids = [index[team] for team in members if team in index]
        if not ids:
            continue
        for i in ids:
            atb[i] += score
            for j in ids:
                ata[i][j] += 1.0
        total += score
        slots += len(ids)
    mean = total / slots if slots else 0.0
    for i in range(n):
        ata[i][i] += ridge
        atb[i] += ridge * mean
    # Gaussian elimination.
    for col in range(n):
        pivot = max(range(col, n), key=lambda row: abs(ata[row][col]))
        if abs(ata[pivot][col]) < 1e-10:
            return {}
        if pivot != col:
            ata[col], ata[pivot] = ata[pivot], ata[col]
            atb[col], atb[pivot] = atb[pivot], atb[col]
        div = ata[col][col]
        for row in range(col + 1, n):
            factor = ata[row][col] / div
            if factor == 0:
                continue
            for k in range(col, n):
                ata[row][k] -= factor * ata[col][k]
            atb[row] -= factor * atb[col]
    x = [0.0] * n
    for row in range(n - 1, -1, -1):
        if abs(ata[row][row]) < 1e-10:
            return {}
        acc = atb[row]
        for k in range(row + 1, n):
            acc -= ata[row][k] * x[k]
        x[row] = acc / ata[row][row]
    return {team: x[index[team]] for team in teams}


def event_ratings(event: dict, matches: list[dict]) -> list[dict]:
    qual = []
    playoff = []
    counts: dict[str, int] = {}
    qual_counts: dict[str, int] = {}
    playoff_counts: dict[str, int] = {}
    for match in matches:
        for side, score_key in (("red", "redScore"), ("blue", "blueScore")):
            alliance = (match[side], match[score_key])
            if match["level"] == "qm":
                qual.append(alliance)
                bucket = qual_counts
            else:
                playoff.append(alliance)
                bucket = playoff_counts
            for team in match[side]:
                counts[team] = counts.get(team, 0) + 1
                bucket[team] = bucket.get(team, 0) + 1
    overall = solve(qual + playoff)
    qual_opr = solve(qual) if len(qual) >= 6 else {}
    playoff_opr = solve(playoff) if len(playoff) >= 6 else {}
    rows = []
    for team, matches_played in counts.items():
        if team not in overall:
            continue
        rows.append(
            {
                "event": event["key"],
                "team": team,
                "matches": matches_played,
                "opr": round(overall[team], 3),
                "qualMatches": qual_counts.get(team, 0),
                "qualOpr": round(qual_opr[team], 3) if team in qual_opr else None,
                "playoffMatches": playoff_counts.get(team, 0),
                "playoffOpr": round(playoff_opr[team], 3) if team in playoff_opr else None,
            }
        )
    return rows


def main() -> None:
    events = []
    for year in (2024, 2025, 2026):
        events.extend(parse_index(year))
    # GRITS is 16 Oct 2026. Anything later cannot be a prior for this study.
    events = [event for event in events if event["end"] < "2026-10-16"]
    print(f"events to read: {len(events)}", flush=True)

    def one(event: dict) -> tuple[dict, list[dict], str | None]:
        dest = os.path.join(CACHE, "strength", f"{event['key']}.html")
        try:
            path = fetch(f"https://www.thebluealliance.com/event/{event['key']}", dest)
        except Exception as exc:  # noqa: BLE001
            return event, [], str(exc)
        matches = parse_matches(open(path, errors="ignore").read())
        if len(matches) < 6:
            return event, [], None
        return event, event_ratings(event, matches), None

    ratings: list[dict] = []
    kept_events = []
    failures = []
    empty_events = []
    with ThreadPoolExecutor(max_workers=12) as pool:
        futures = [pool.submit(one, event) for event in events]
        done = 0
        for future in as_completed(futures):
            event, rows, error = future.result()
            done += 1
            if error:
                failures.append({"event": event["key"], "error": error[:180]})
            elif not rows:
                empty_events.append(event["key"])
            else:
                kept_events.append({**event, "teams": len(rows)})
                ratings.extend(rows)
            if done % 40 == 0:
                print(
                    f"  {done}/{len(events)} kept {len(kept_events)} empty {len(empty_events)} failed {len(failures)}",
                    flush=True,
                )

    kept_events.sort(key=lambda event: (event["end"], event["key"]))
    ratings.sort(key=lambda row: (row["event"], row["team"]))
    payload = {
        "fetched": FETCHED,
        "source": "The Blue Alliance public event pages (https://www.thebluealliance.com/event/{key}). No API key. Statbotics REST returned HTTP 500 on 2026-10-26, so it was not used.",
        "identity": "Per-robot ridge OPR (ridge 2) of the scoreboard total. Category splits are not on these pages.",
        "skippedFixtureEvents": sorted(SKIP_EVENTS),
        "eventCount": len(kept_events),
        "teamEventCount": len(ratings),
        "emptyEvents": sorted(empty_events),
        "failures": failures,
        "events": kept_events,
        "ratings": ratings,
    }
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w") as handle:
        json.dump(payload, handle, separators=(",", ":"))
    print(
        f"wrote {OUT} events {len(kept_events)} ratings {len(ratings)} empty {len(empty_events)} failed {len(failures)} bytes {os.path.getsize(OUT)}"
    )


if __name__ == "__main__":
    main()
