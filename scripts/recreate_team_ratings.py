"""
Compute offensive/defensive ratings for teams in teams.csv.

Methods:
  elo   — exp((rating - 1500) / 400), exp(-(rating - 1500) / 400)
  goals — goals_for / matches, goals_against / matches

Both methods normalize so mean offensive = mean defensive = 1.0 across the
teams listed in teams.csv. Elo/goals source data comes from elo_ratings.csv.
"""

from __future__ import annotations

import argparse
import csv
import math
import sys
from pathlib import Path
from typing import Literal

ELO_BASE = 1500
ELO_SCALE = 400
DATA_DIR = Path(__file__).resolve().parent.parent / "data"

RatingMethod = Literal["elo", "goals"]

ELO_COLUMNS = ("rank", "rating", "total", "goals_for", "goals_against")


def raw_elo_ratings(elo_rating: float) -> tuple[float, float]:
    elo_delta = (elo_rating - ELO_BASE) / ELO_SCALE
    return math.exp(elo_delta), math.exp(-elo_delta)


def raw_goals_ratings(
    goals_for: float,
    goals_against: float,
    matches: float,
) -> tuple[float, float]:
    if matches <= 0:
        raise ValueError(f"matches must be positive, got {matches}")
    return goals_for / matches, goals_against / matches


def normalize_ratings(
    pairs: list[tuple[float, float]],
) -> list[tuple[float, float]]:
    mean_off = sum(off for off, _ in pairs) / len(pairs)
    mean_def = sum(de for _, de in pairs) / len(pairs)
    return [(off / mean_off, de / mean_def) for off, de in pairs]


def compute_ratings(
    method: RatingMethod,
    elo_row: dict[str, str],
) -> tuple[float, float]:
    if method == "elo":
        return raw_elo_ratings(float(elo_row["rating"]))
    return raw_goals_ratings(
        float(elo_row["goals_for"]),
        float(elo_row["goals_against"]),
        float(elo_row["total"]),
    )


def load_elo_ratings(path: Path) -> dict[str, dict[str, str]]:
    with path.open(newline="", encoding="utf-8-sig") as f:
        rows = list(csv.DictReader(f))
    by_team: dict[str, dict[str, str]] = {}
    for row in rows:
        team = row["team"]
        if team in by_team:
            raise ValueError(f"Duplicate team in {path}: {team!r}")
        by_team[team] = row
    return by_team


def load_teams(path: Path) -> tuple[list[str], list[list[str]]]:
    with path.open(newline="", encoding="utf-8-sig") as f:
        reader = csv.reader(f)
        header = next(reader)
        rows = list(reader)
    return header, rows


def build_team_ratings(
    teams_path: Path,
    elo_path: Path,
    method: RatingMethod,
) -> tuple[list[str], list[list[str]], list[str]]:
    header, team_rows = load_teams(teams_path)
    elo_by_team = load_elo_ratings(elo_path)

    required = {"team", "offensive_rating", "defensive_rating"}
    if not required.issubset(header):
        raise ValueError(f"{teams_path} must include columns: {sorted(required)}")

    team_idx = header.index("team")
    off_idx = header.index("offensive_rating")
    def_idx = header.index("defensive_rating")
    col_index = {name: header.index(name) for name in ELO_COLUMNS if name in header}

    warnings: list[str] = []
    raw_pairs: list[tuple[float, float]] = []
    elo_rows: list[dict[str, str]] = []

    for row in team_rows:
        if len(row) != len(header):
            raise ValueError(f"Row length mismatch for team {row[team_idx]!r}")
        name = row[team_idx]
        elo_row = elo_by_team.get(name)
        if elo_row is None:
            raise ValueError(f"No Elo row for team {name!r} in {elo_path}")
        elo_rows.append(elo_row)
        raw_pairs.append(compute_ratings(method, elo_row))

    normalized = normalize_ratings(raw_pairs)

    for row, elo_row, (off, de) in zip(team_rows, elo_rows, normalized):
        for col, idx in col_index.items():
            row[idx] = elo_row[col]
        if method == "elo":
            stored_off = float(row[off_idx])
            stored_def = float(row[def_idx])
            if abs(stored_off - off) > 1e-9 or abs(stored_def - de) > 1e-9:
                warnings.append(
                    f"{row[team_idx]}: stored {stored_off:.6f}/{stored_def:.6f}, "
                    f"recomputed {off:.6f}/{de:.6f}"
                )
        row[off_idx] = repr(off)
        row[def_idx] = repr(de)

    return header, team_rows, warnings


def write_teams(path: Path, header: list[str], rows: list[list[str]]) -> None:
    with path.open("w", newline="", encoding="utf-8") as f:
        writer = csv.writer(f)
        writer.writerow(header)
        writer.writerows(rows)


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Compute offensive/defensive ratings for teams.csv",
    )
    parser.add_argument(
        "--method",
        choices=("elo", "goals"),
        default="elo",
        help='Rating source: "elo" (default) or "goals" (per-game GF/GA)',
    )
    parser.add_argument(
        "--teams",
        type=Path,
        default=DATA_DIR / "teams.csv",
        help="Team list CSV (default: data/teams.csv)",
    )
    parser.add_argument(
        "--elo",
        type=Path,
        default=DATA_DIR / "elo_ratings.csv",
        help="Elo/goals source CSV (default: data/elo_ratings.csv)",
    )
    parser.add_argument(
        "--write",
        action="store_true",
        help="Write updated ratings back to --teams",
    )
    parser.add_argument(
        "--output",
        type=Path,
        help="Write to this path instead of --teams (implies --write)",
    )
    args = parser.parse_args()

    if not args.teams.is_file():
        print(f"Error: teams file not found: {args.teams}", file=sys.stderr)
        return 1
    if not args.elo.is_file():
        print(f"Error: elo file not found: {args.elo}", file=sys.stderr)
        return 1

    try:
        header, rows, warnings = build_team_ratings(args.teams, args.elo, args.method)
    except ValueError as exc:
        print(f"Error: {exc}", file=sys.stderr)
        return 1

    print(f"Computed {args.method} ratings for {len(rows)} teams")
    if args.method == "elo":
        print(f"  elo_delta = (rating - {ELO_BASE}) / {ELO_SCALE}")
    else:
        print("  offensive = goals_for / matches")
        print("  defensive = goals_against / matches")
    print("  normalized to mean offensive = mean defensive = 1.0")

    if args.method == "elo":
        if warnings:
            print(f"\n{len(warnings)} team(s) differ from stored ratings:")
            for line in warnings:
                print(f"  {line}")
        else:
            print("\nAll stored ratings match recomputed values.")
    elif not args.write and not args.output:
        print("\nPreview (first 5 by offensive rating):")
        off_idx = header.index("offensive_rating")
        team_idx = header.index("team")
        preview = sorted(rows, key=lambda r: float(r[off_idx]), reverse=True)[:5]
        for row in preview:
            print(f"  {row[team_idx]}: {row[off_idx]} / {row[header.index('defensive_rating')]}")

    out_path = args.output or args.teams
    if args.write or args.output:
        write_teams(out_path, header, rows)
        print(f"\nWrote {out_path}")
    elif warnings:
        print("\nRun with --write to update teams.csv, or --output PATH for a copy.")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
