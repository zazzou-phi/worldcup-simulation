#!/usr/bin/env python3
"""Export FIFA World Cup 2026 group-stage fixtures to iCalendar (.ics).

Only group-stage matches involving teams listed in interested_teams.txt are
included. Override with --teams or set INTERESTED_TEAMS below.
"""

from __future__ import annotations

import argparse
import csv
import re
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent
FIXTURES_CSV = ROOT / "worldcup_2026_fixtures.csv"
INTERESTED_TEAMS_FILE = ROOT / "interested_teams.txt"
OUTPUT_ICS = ROOT / "worldcup_2026.ics"
MATCH_DURATION = timedelta(hours=2)
PRODID = "-//WC Simulation//World Cup 2026 Schedule//EN"

# Optional fallback when interested_teams.txt is empty and --teams is not passed.
INTERESTED_TEAMS: list[str] = []

TEAM_ALIASES = {
    "Czech Republic": "Czechia",
    "USA": "United States",
    "Bosnia & Herzegovina": "Bosnia and Herzegovina",
}

_TIME_RE = re.compile(r"(\d{2}):(\d{2})\s+UTC([+-]\d+)")


def normalize_team(name: str) -> str:
    return TEAM_ALIASES.get(name.strip(), name.strip())


def load_interested_teams(path: Path, cli_teams: list[str] | None) -> list[str]:
    if cli_teams:
        return [normalize_team(team) for team in cli_teams if team.strip()]

    if INTERESTED_TEAMS:
        return [normalize_team(team) for team in INTERESTED_TEAMS if team.strip()]

    if not path.exists():
        return []

    teams: list[str] = []
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        teams.append(normalize_team(line))
    return teams


def team_matches(name: str, interested: set[str]) -> bool:
    normalized = normalize_team(name)
    return normalized in interested or name.strip() in interested


def fixture_involves_team(row: dict[str, str], interested: set[str]) -> bool:
    return team_matches(row["team1"], interested) or team_matches(row["team2"], interested)


def select_group_matches(
    rows: list[dict[str, str]],
    interested: set[str],
) -> list[dict[str, str]]:
    return [
        row
        for row in rows
        if row.get("group", "").strip() and fixture_involves_team(row, interested)
    ]


def parse_kickoff(date_str: str, time_str: str) -> datetime:
    match = _TIME_RE.match(time_str.strip())
    if not match:
        raise ValueError(f"Unparseable time: {time_str!r}")
    hour, minute = int(match.group(1)), int(match.group(2))
    offset_hours = int(match.group(3))
    local_offset = timezone(timedelta(hours=offset_hours))
    kickoff = datetime.strptime(date_str, "%Y-%m-%d").replace(
        hour=hour, minute=minute, tzinfo=local_offset
    )
    return kickoff.astimezone(timezone.utc)


def ical_escape(text: str) -> str:
    return (
        text.replace("\\", "\\\\")
        .replace(";", "\\;")
        .replace(",", "\\,")
        .replace("\n", "\\n")
    )


def format_utc(dt: datetime) -> str:
    return dt.astimezone(timezone.utc).strftime("%Y%m%dT%H%M%SZ")


def event_summary(row: dict[str, str]) -> str:
    home, away = row["team1"], row["team2"]
    group = row.get("group", "").strip()
    round_name = row["round"].strip()
    if group:
        return f"{home} vs {away} — {group}"
    return f"{round_name}: {home} vs {away}"


def event_description(row: dict[str, str]) -> str:
    lines = [
        f"Match #{row['match_number']}",
        row["round"],
    ]
    if row.get("group", "").strip():
        lines.append(row["group"])
    lines.append(f"Venue: {row['venue']}")
    return "\\n".join(lines)


def build_event(row: dict[str, str], stamp: str) -> str:
    start = parse_kickoff(row["date"], row["time"])
    end = start + MATCH_DURATION
    uid = f"wc2026-match-{row['match_number']}@wc-simulation"
    summary = ical_escape(event_summary(row))
    location = ical_escape(row["venue"])
    description = ical_escape(event_description(row))

    return "\r\n".join(
        [
            "BEGIN:VEVENT",
            f"UID:{uid}",
            f"DTSTAMP:{stamp}",
            f"DTSTART:{format_utc(start)}",
            f"DTEND:{format_utc(end)}",
            f"SUMMARY:{summary}",
            f"LOCATION:{location}",
            f"DESCRIPTION:{description}",
            "STATUS:CONFIRMED",
            "TRANSP:OPAQUE",
            "END:VEVENT",
        ]
    )


def export_ical(
    interested_teams: list[str],
    fixtures_csv: Path = FIXTURES_CSV,
    output_ics: Path = OUTPUT_ICS,
) -> int:
    interested = {normalize_team(team) for team in interested_teams}
    if not interested:
        raise ValueError(
            "No interested teams configured. Add teams to "
            f"{INTERESTED_TEAMS_FILE.name}, set INTERESTED_TEAMS in this script, "
            "or pass --teams."
        )

    stamp = format_utc(datetime.now(timezone.utc))
    with fixtures_csv.open(newline="", encoding="utf-8") as handle:
        rows = list(csv.DictReader(handle))

    rows = select_group_matches(rows, interested)
    rows.sort(key=lambda row: (row["date"], row["time"], int(row["match_number"])))

    team_label = ", ".join(sorted(interested_teams))
    events = "\r\n".join(build_event(row, stamp) for row in rows)
    calendar = "\r\n".join(
        [
            "BEGIN:VCALENDAR",
            "VERSION:2.0",
            f"PRODID:{PRODID}",
            "CALSCALE:GREGORIAN",
            "METHOD:PUBLISH",
            f"X-WR-CALNAME:FIFA World Cup 2026 — {ical_escape(team_label)}",
            "X-WR-TIMEZONE:UTC",
            events,
            "END:VCALENDAR",
            "",
        ]
    )
    output_ics.write_text(calendar, encoding="utf-8")
    return len(rows)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Export World Cup 2026 group-stage fixtures to iCalendar for selected teams."
    )
    parser.add_argument(
        "--teams",
        nargs="+",
        help="Team names to include (overrides interested_teams.txt)",
    )
    parser.add_argument(
        "--config",
        type=Path,
        default=INTERESTED_TEAMS_FILE,
        help=f"Path to team list file (default: {INTERESTED_TEAMS_FILE.name})",
    )
    parser.add_argument(
        "--output",
        type=Path,
        default=OUTPUT_ICS,
        help=f"Output .ics path (default: {OUTPUT_ICS.name})",
    )
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    interested_teams = load_interested_teams(args.config, args.teams)
    try:
        count = export_ical(interested_teams, output_ics=args.output)
    except ValueError as exc:
        print(exc, file=sys.stderr)
        sys.exit(1)

    teams_label = ", ".join(interested_teams)
    print(f"Wrote {count} events for {teams_label} to {args.output}")


if __name__ == "__main__":
    main()
