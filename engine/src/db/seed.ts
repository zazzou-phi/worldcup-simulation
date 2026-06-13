import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'csv-parse/sync';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import type Database from 'better-sqlite3';
import { initSchema } from './client.js';
import * as schema from './schema.js';
import { Repository } from './repository.js';
import { computeNormalizedTeamRatings } from '../engine/teamRatings.js';
import {
  flagForTeamName,
  normalizeTeamName,
  TEAM_COUNTRY_CODES,
  countryCodeToEmoji,
} from '../lib/flags.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, '../../..');

function readCsv(filename: string) {
  return parse(readFileSync(join(DATA_DIR, filename), 'utf8'), {
    columns: true,
    skip_empty_lines: true,
    trim: true,
  }) as Record<string, string>[];
}

function teamFlag(name: string): string {
  const code = TEAM_COUNTRY_CODES[name];
  if (code) return countryCodeToEmoji(code);
  return flagForTeamName(name);
}

export function seedDatabase(sqlite: Database.Database) {
  initSchema(sqlite);

  const hasActualResults =
    (sqlite.prepare('SELECT COUNT(*) as c FROM actual_match_results').get() as { c: number })
      .c > 0;

  // Delete in FK-safe order (children before parents).
  sqlite.exec('DELETE FROM simulation_matches');
  sqlite.exec('DELETE FROM group_memberships');
  sqlite.exec('DELETE FROM simulations');
  if (!hasActualResults) {
    sqlite.exec('DELETE FROM fixtures');
    sqlite.exec('DELETE FROM teams');
  }

  const teamsRows = readCsv('teams.csv');
  const nameToId = new Map<string, number>();

  const ratingInputs = teamsRows.map((row) => ({
    elo: parseInt(row.rating, 10),
    goalsFor: parseInt(row.goals_for, 10),
    goalsAgainst: parseInt(row.goals_against, 10),
    total: parseInt(row.total, 10),
  }));
  const computedRatings = computeNormalizedTeamRatings(ratingInputs);

  const insertTeam = sqlite.prepare(`
    INSERT OR REPLACE INTO teams (
      id, name, country_code, flag, rank, rating, elo, total, goals_for, goals_against,
      elo_offensive_rating, elo_defensive_rating, goal_offensive_rating, goal_defensive_rating,
      blend_offensive_rating, blend_defensive_rating
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  for (const [index, row] of teamsRows.entries()) {
    const keys = Object.keys(row);
    const idKey = keys.find((k) => k === '' || k === '0') ?? keys[0];
    const id = parseInt(row[idKey], 10);
    const name = row.team;
    nameToId.set(name, id);
    const ratings = computedRatings[index]!;
    insertTeam.run(
      id,
      name,
      TEAM_COUNTRY_CODES[name] ?? null,
      teamFlag(name),
      parseInt(row.rank, 10),
      parseInt(row.rating, 10),
      parseInt(row.rating, 10),
      parseInt(row.total, 10),
      parseInt(row.goals_for, 10),
      parseInt(row.goals_against, 10),
      ratings.eloOffensiveRating,
      ratings.eloDefensiveRating,
      ratings.goalOffensiveRating,
      ratings.goalDefensiveRating,
      ratings.blendOffensiveRating,
      ratings.blendDefensiveRating,
    );
  }

  const resolveTeamId = (name: string): number | null => {
    const normalized = normalizeTeamName(name);
    return nameToId.get(normalized) ?? null;
  };

  const fixtureRows = readCsv('worldcup_2026_fixtures.csv');
  const insertFixture = sqlite.prepare(`
    INSERT OR REPLACE INTO fixtures (match_number, round, date, time, venue, "group", slot_home, slot_away, team_home_id, team_away_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const groupTeams = new Map<string, Set<number>>();

  for (const row of fixtureRows) {
    const matchNumber = parseInt(row.match_number, 10);
    const group = row.group || null;
    const slotHome = row.team1;
    const slotAway = row.team2;
    let teamHomeId: number | null = null;
    let teamAwayId: number | null = null;

    if (group) {
      teamHomeId = resolveTeamId(slotHome);
      teamAwayId = resolveTeamId(slotAway);
      const letter = group.replace('Group ', '');
      if (!groupTeams.has(letter)) groupTeams.set(letter, new Set());
      if (teamHomeId != null) groupTeams.get(letter)!.add(teamHomeId);
      if (teamAwayId != null) groupTeams.get(letter)!.add(teamAwayId);
    }

    insertFixture.run(
      matchNumber,
      row.round,
      row.date,
      row.time,
      row.venue,
      group,
      slotHome,
      slotAway,
      teamHomeId,
      teamAwayId,
    );
  }

  const insertMembership = sqlite.prepare(
    'INSERT OR REPLACE INTO group_memberships (group_letter, team_id) VALUES (?, ?)',
  );
  for (const [letter, ids] of groupTeams) {
    for (const id of ids) {
      insertMembership.run(letter, id);
    }
  }

  const repo = new Repository(drizzle(sqlite, { schema }));
  repo.ensureDefaultSimulation();

  return { teamCount: teamsRows.length, fixtureCount: fixtureRows.length };
}
