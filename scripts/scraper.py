"""
Scraper for eloratings.net

The site renders ratings with JavaScript (SlickGrid) and loads data from TSV
files rather than HTML tables. This script fetches those files directly.
"""

from io import StringIO
from pathlib import Path
from urllib.request import urlopen

import pandas as pd

BASE_URL = "https://www.eloratings.net"
DATA_DIR = Path(__file__).resolve().parent.parent / "data"
DEFAULT_OUTPUT = DATA_DIR / "elo_ratings.csv"

RATING_COLUMNS = [
    "local_rank",
    "rank",
    "team_code",
    "rating",
    "rank_max",
    "rating_max",
    "rank_avg",
    "rating_avg",
    "rank_min",
    "rating_min",
    "rank_three_month_change",
    "rating_three_month_change",
    "rank_six_month_change",
    "rating_six_month_change",
    "rank_one_year_change",
    "rating_one_year_change",
    "rank_two_year_change",
    "rating_two_year_change",
    "rank_five_year_change",
    "rating_five_year_change",
    "rank_ten_year_change",
    "rating_ten_year_change",
    "total",
    "home",
    "away",
    "neutral",
    "wins",
    "losses",
    "draws",
    "goals_for",
    "goals_against",
    "rank_chg",
    "rating_chg",
]


def _fetch_text(path: str) -> str:
    with urlopen(f"{BASE_URL}/{path}") as response:
        return response.read().decode("utf-8")


def _load_team_names() -> dict[str, str]:
    text = _fetch_text("en.teams.tsv")
    teams = {}
    for line in text.splitlines():
        if not line.strip():
            continue
        code, *names = line.split("\t")
        teams[code] = names[0]
    return teams


def scrape_elo_ratings(output_csv=DEFAULT_OUTPUT, page="World"):
    print(f"Fetching {page} ratings from eloratings.net...")
    ratings_text = _fetch_text(f"{page}.tsv")
    team_names = _load_team_names()

    df = pd.read_csv(
        StringIO(ratings_text),
        sep="\t",
        header=None,
        names=RATING_COLUMNS,
        converters={"team_code": str},
    )
    df["team"] = df["team_code"].map(team_names)

    missing = df["team"].isna().sum()
    if missing:
        print(f"Warning: no name found for {missing} team code(s).")

    print(df[["rank", "team", "rating"]].head())
    print(f"\nSaving {len(df)} rows to '{output_csv}'...")
    df.to_csv(output_csv, index=False, encoding="utf-8-sig")
    print("Done!")
    return df


if __name__ == "__main__":
    df = scrape_elo_ratings(DEFAULT_OUTPUT)
    print(f"\nShape: {df.shape}")
    print(df[["rank", "team", "rating"]].head(10))
