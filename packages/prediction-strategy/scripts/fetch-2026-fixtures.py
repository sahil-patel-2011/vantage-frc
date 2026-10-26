#!/usr/bin/env python3
"""Download public 2026 match breakdowns and write a trimmed fixture.

Source: The Blue Alliance match pages (no API key). Statbotics' public REST API
returned HTTP 500/503 on the fetch date, so it is not the source of these rows.

Nothing here is guessed. A match is kept only when the page lists three robots
per alliance and numeric Total Auto, Total Teleop, Endgame Tower Points, Foul
Points, and Total Score for both alliances.
"""

from __future__ import annotations

import json
import os
import re
import time
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed

UA = "Mozilla/5.0 (compatible; vantage-research/1.0; +https://github.com/sahil-patel-2011/vantage-frc)"
CACHE = os.environ.get("TBA_CACHE", "/tmp/tba-cache")
OUT = os.path.join(
    os.path.dirname(__file__),
    "..",
    "test",
    "fixtures",
    "2026-played-matches.json",
)

# Event list is the public TBA keys confirmed from event pages, not a guess.
EVENTS = [
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
]

ROW = re.compile(
    r'<td class="(?:redScore|red)"[^>]*>\s*(?:<b>)?\s*(-?\d+(?:\.\d+)?)\s*(?:</b>)?\s*</td>\s*'
    r"<t([dh])>\s*([^<]+?)\s*</t\2>\s*"
    r'<td class="(?:blueScore|blue)"[^>]*>\s*(?:<b>)?\s*(-?\d+(?:\.\d+)?)',
    re.S,
)
KEY_RE = re.compile(r'href="/match/((?:2026[a-z0-9]+)_(?:qm|ef|qf|sf|f)\d+(?:m\d+)?)"')


def fetch(url: str, dest: str, tries: int = 5) -> str:
    os.makedirs(os.path.dirname(dest), exist_ok=True)
    if os.path.exists(dest) and os.path.getsize(dest) > 800:
        return dest
    last: Exception | None = None
    for i in range(tries):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": UA})
            with urllib.request.urlopen(req, timeout=45) as resp:
                data = resp.read()
            if len(data) < 800 or b"Server Error" in data[:400]:
                raise RuntimeError(f"bad body {len(data)}")
            with open(dest, "wb") as handle:
                handle.write(data)
            return dest
        except Exception as exc:  # noqa: BLE001 — retry network failures
            last = exc
            time.sleep(0.8 * (i + 1))
    raise RuntimeError(f"{url} failed: {last}")


def text(path: str) -> str:
    with open(path, errors="ignore") as handle:
        return handle.read()


def event_page(key: str) -> tuple[dict, list[str]]:
    path = fetch(f"https://www.thebluealliance.com/event/{key}", os.path.join(CACHE, f"{key}.html"))
    html = text(path)
    name = re.search(r'id="event-name">([^<]+)', html)
    # Event span only. The page footer also has a "generated on" timestamp.
    times = re.findall(r'<time datetime="(\d{4}-\d{2}-\d{2})T', html)
    keys: list[str] = []
    seen: set[str] = set()
    for match in KEY_RE.finditer(html):
        match_key = match.group(1)
        if match_key.startswith(key + "_") and match_key not in seen:
            seen.add(match_key)
            keys.append(match_key)
    return {
        "key": key,
        "name": re.sub(r"\s+", " ", name.group(1)).strip() if name else key,
        "start": times[0] if times else None,
        "end": times[1] if len(times) > 1 else (times[0] if times else None),
        "page": f"https://www.thebluealliance.com/event/{key}",
    }, keys


def num_map(html: str) -> dict[str, tuple[float, float]]:
    out: dict[str, tuple[float, float]] = {}
    for red, _tag, label, blue in ROW.findall(html):
        out[re.sub(r"\s+", " ", label).strip()] = (float(red), float(blue))
    return out


def parse_match(event: str, match_key: str, order: int) -> dict | None:
    path = fetch(
        f"https://www.thebluealliance.com/match/{match_key}",
        os.path.join(CACHE, "matches", f"{match_key}.html"),
    )
    html = text(path)
    marker = f'id="match-table-{match_key}"'
    if marker not in html:
        return None
    table = html.split(marker, 1)[1].split("</table>", 1)[0]
    teams = [int(team) for team in re.findall(r'data-team="frc(\d+)"', table)]
    if len(teams) != 6:
        return None
    scores = num_map(html)
    needed = ["Total Auto", "Teleop Fuel Points", "Endgame Tower Points", "Foul Points", "Total Score", "Total Teleop"]
    if any(label not in scores for label in needed):
        return None

    def side(index: int) -> dict:
        auto = scores["Total Auto"][index]
        # TBA's "Total Teleop" already includes Endgame Tower Points. Teleop here is
        # the fuel scored in teleop, so auto + teleop + endgame + foul + adjust = total.
        teleop = scores["Teleop Fuel Points"][index]
        endgame = scores["Endgame Tower Points"][index]
        foul = scores["Foul Points"][index]
        total = scores["Total Score"][index]
        fuel = scores.get("Total Fuel Points", (None, None))[index]
        adjust = scores.get("Adjustments", (0.0, 0.0))[index]
        teleop_total = scores["Total Teleop"][index]
        return {
            "auto": auto,
            "teleop": teleop,
            "endgame": endgame,
            "foul": foul,
            "fuel": fuel,
            "adjust": adjust,
            "teleopTotal": teleop_total,
            "total": total,
        }

    red = side(0)
    blue = side(1)
    level = match_key.split("_", 1)[1]
    kind = re.match(r"[a-z]+", level)
    number = re.search(r"(\d+)$", level)
    set_number = re.search(r"(?:ef|qf|sf|f)(\d+)m", level)
    winner = "tie"
    if red["total"] > blue["total"]:
        winner = "red"
    elif blue["total"] > red["total"]:
        winner = "blue"
    return {
        "key": match_key,
        "event": event,
        "level": kind.group(0) if kind else level,
        "set": int(set_number.group(1)) if set_number else 1,
        "number": int(number.group(1)) if number else order,
        "order": order,
        "red": teams[:3],
        "blue": teams[3:],
        "winner": winner,
        "redScore": red,
        "blueScore": blue,
    }


def whole(value: float) -> int | float:
    if abs(value - round(value)) < 1e-6:
        return int(round(value))
    return value


def main() -> None:
    events = []
    jobs: list[tuple[str, str, int]] = []
    for key in EVENTS:
        meta, match_keys = event_page(key)
        events.append({**meta, "matchesListed": len(match_keys)})
        for order, match_key in enumerate(match_keys):
            jobs.append((key, match_key, order))
    print(f"listed {len(jobs)} matches", flush=True)

    parsed: list[dict | None] = [None] * len(jobs)
    failures: list[str] = []
    done = 0
    with ThreadPoolExecutor(max_workers=12) as pool:
        futs = {pool.submit(parse_match, event, match_key, order): i for i, (event, match_key, order) in enumerate(jobs)}
        for fut in as_completed(futs):
            index = futs[fut]
            done += 1
            try:
                parsed[index] = fut.result()
                if parsed[index] is None:
                    failures.append(jobs[index][1] + " incomplete")
            except Exception as exc:  # noqa: BLE001
                failures.append(f"{jobs[index][1]} {exc}")
            if done % 100 == 0 or done == len(jobs):
                print(f"parsed {done}/{len(jobs)} failures {len(failures)}", flush=True)

    matches = [row for row in parsed if row is not None]
    for row in matches:
        for side in ("redScore", "blueScore"):
            for key, value in list(row[side].items()):
                if isinstance(value, float):
                    row[side][key] = whole(value)
    identity_miss = 0
    for row in matches:
        for side in ("redScore", "blueScore"):
            score = row[side]
            summed = score["auto"] + score["teleop"] + score["endgame"] + score["foul"] + score["adjust"]
            if abs(summed - score["total"]) > 0.01 or abs(score["teleop"] + score["endgame"] - score["teleopTotal"]) > 0.01:
                identity_miss += 1
    payload = {
        "fetched": "2026-10-26",
        "source": "The Blue Alliance public match pages (https://www.thebluealliance.com/match/{key}). No API key. Statbotics REST https://api.statbotics.io/v3/matches returned HTTP 500/503 on this date, so it was not used.",
        "identity": "total = auto + teleop fuel + endgame tower + foul points + adjustments. TBA Total Teleop (stored as teleopTotal) already includes the tower, so it is not added again. fuel overlaps auto and teleop and is not added.",
        "events": events,
        "matchCount": len(matches),
        "listedCount": len(jobs),
        "identityMisses": identity_miss,
        "incomplete": failures,
        "matches": matches,
    }
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w") as handle:
        json.dump(payload, handle, separators=(",", ":"))
        handle.write("\n")
    print(f"wrote {OUT} matches {len(matches)} identity misses {identity_miss} incomplete {len(failures)}")


if __name__ == "__main__":
    main()
