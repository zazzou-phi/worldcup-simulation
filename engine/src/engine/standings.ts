import type { GroupStandings, StandingRow, Team } from './types.js';

export interface PlayedGroupMatch {
  homeTeamId: number;
  awayTeamId: number;
  goalsHome: number;
  goalsAway: number;
}

export interface GroupFixtureRef {
  matchNumber: number;
  group: string | null;
  teamHomeId: number | null;
  teamAwayId: number | null;
}

export interface GroupMatchResultSource {
  matchNumber: number;
  goalsHome: number | null;
  goalsAway: number | null;
  status: 'scheduled' | 'played';
}

export interface ActualGroupMatchResult {
  matchNumber: number;
  goalsHome: number;
  goalsAway: number;
}

/** Prefer actual results over simulation predictions when building group standings. */
export function collectPlayedGroupMatches(
  fixtures: GroupFixtureRef[],
  simulationMatches: GroupMatchResultSource[],
  actualResults: ActualGroupMatchResult[],
): PlayedGroupMatch[] {
  const actualByMatch = new Map(actualResults.map((r) => [r.matchNumber, r]));
  const simByMatch = new Map(simulationMatches.map((m) => [m.matchNumber, m]));
  const playedGroup: PlayedGroupMatch[] = [];

  for (const fixture of fixtures) {
    if (fixture.group == null || fixture.teamHomeId == null || fixture.teamAwayId == null) {
      continue;
    }

    const actual = actualByMatch.get(fixture.matchNumber);
    if (actual) {
      playedGroup.push({
        homeTeamId: fixture.teamHomeId,
        awayTeamId: fixture.teamAwayId,
        goalsHome: actual.goalsHome,
        goalsAway: actual.goalsAway,
      });
      continue;
    }

    const match = simByMatch.get(fixture.matchNumber);
    if (match?.status !== 'played' || match.goalsHome == null || match.goalsAway == null) {
      continue;
    }

    playedGroup.push({
      homeTeamId: fixture.teamHomeId,
      awayTeamId: fixture.teamAwayId,
      goalsHome: match.goalsHome,
      goalsAway: match.goalsAway,
    });
  }

  return playedGroup;
}

interface MutableRow {
  teamId: number;
  team: Team;
  played: number;
  won: number;
  drawn: number;
  lost: number;
  goalsFor: number;
  goalsAgainst: number;
  points: number;
}

function initRow(team: Team): MutableRow {
  return {
    teamId: team.id,
    team,
    played: 0,
    won: 0,
    drawn: 0,
    lost: 0,
    goalsFor: 0,
    goalsAgainst: 0,
    points: 0,
  };
}

function applyResult(row: MutableRow, gf: number, ga: number) {
  row.played += 1;
  row.goalsFor += gf;
  row.goalsAgainst += ga;
  if (gf > ga) {
    row.won += 1;
    row.points += 3;
  } else if (gf === ga) {
    row.drawn += 1;
    row.points += 1;
  } else {
    row.lost += 1;
  }
}

function h2hStats(
  teamIds: number[],
  matches: PlayedGroupMatch[],
): Map<number, { pts: number; gd: number; gf: number }> {
  const stats = new Map<number, { pts: number; gd: number; gf: number }>();
  for (const id of teamIds) stats.set(id, { pts: 0, gd: 0, gf: 0 });

  for (const m of matches) {
    if (!teamIds.includes(m.homeTeamId) || !teamIds.includes(m.awayTeamId)) continue;
    const home = stats.get(m.homeTeamId)!;
    const away = stats.get(m.awayTeamId)!;
    home.gf += m.goalsHome;
    away.gf += m.goalsAway;
    home.gd += m.goalsHome - m.goalsAway;
    away.gd += m.goalsAway - m.goalsHome;
    if (m.goalsHome > m.goalsAway) {
      home.pts += 3;
    } else if (m.goalsHome === m.goalsAway) {
      home.pts += 1;
      away.pts += 1;
    } else {
      away.pts += 3;
    }
  }
  return stats;
}

function compareRows(
  a: MutableRow,
  b: MutableRow,
  tiedIds: number[],
  matches: PlayedGroupMatch[],
): number {
  if (a.points !== b.points) return b.points - a.points;

  if (tiedIds.length >= 2) {
    const h2h = h2hStats(tiedIds, matches);
    const ah = h2h.get(a.teamId)!;
    const bh = h2h.get(b.teamId)!;
    if (ah.pts !== bh.pts) return bh.pts - ah.pts;
    if (ah.gd !== bh.gd) return bh.gd - ah.gd;
    if (ah.gf !== bh.gf) return bh.gf - ah.gf;
  }

  const gdA = a.goalsFor - a.goalsAgainst;
  const gdB = b.goalsFor - b.goalsAgainst;
  if (gdA !== gdB) return gdB - gdA;
  if (a.goalsFor !== b.goalsFor) return b.goalsFor - a.goalsFor;
  return a.team.rank - b.team.rank;
}

function rankGroup(rows: MutableRow[], matches: PlayedGroupMatch[]): StandingRow[] {
  const sorted = [...rows].sort((a, b) => b.points - a.points);
  let i = 0;
  while (i < sorted.length) {
    let j = i + 1;
    while (j < sorted.length && sorted[j].points === sorted[i].points) j++;
    const tiedIds = sorted.slice(i, j).map((r) => r.teamId);
    const block = sorted.slice(i, j);
    block.sort((a, b) => compareRows(a, b, tiedIds, matches));
    for (let k = 0; k < block.length; k++) sorted[i + k] = block[k];
    i = j;
  }

  return sorted.map((r, idx) => ({
    teamId: r.teamId,
    team: r.team,
    played: r.played,
    won: r.won,
    drawn: r.drawn,
    lost: r.lost,
    goalsFor: r.goalsFor,
    goalsAgainst: r.goalsAgainst,
    goalDifference: r.goalsFor - r.goalsAgainst,
    points: r.points,
    position: idx + 1,
  }));
}

export function computeGroupStandings(
  groupLetter: string,
  teamIds: number[],
  teamsById: Map<number, Team>,
  matches: PlayedGroupMatch[],
): GroupStandings {
  const rows = teamIds.map((id) => initRow(teamsById.get(id)!));

  for (const m of matches) {
    const home = rows.find((r) => r.teamId === m.homeTeamId);
    const away = rows.find((r) => r.teamId === m.awayTeamId);
    if (!home || !away) continue;
    applyResult(home, m.goalsHome, m.goalsAway);
    applyResult(away, m.goalsAway, m.goalsHome);
  }

  return { groupLetter, rows: rankGroup(rows, matches) };
}

export function computeAllGroupStandings(
  memberships: { groupLetter: string; teamId: number }[],
  teamsById: Map<number, Team>,
  matches: PlayedGroupMatch[],
): GroupStandings[] {
  const groups = [...new Set(memberships.map((m) => m.groupLetter))].sort();
  return groups.map((g) => {
    const teamIds = memberships.filter((m) => m.groupLetter === g).map((m) => m.teamId);
    const groupMatches = matches.filter(
      (m) => teamIds.includes(m.homeTeamId) && teamIds.includes(m.awayTeamId),
    );
    return computeGroupStandings(g, teamIds, teamsById, groupMatches);
  });
}

export interface ThirdPlaceRow {
  groupLetter: string;
  row: StandingRow;
}

export function rankThirdPlaceTeams(standings: GroupStandings[]): ThirdPlaceRow[] {
  const thirds = standings
    .map((g) => ({ groupLetter: g.groupLetter, row: g.rows[2] }))
    .filter((t) => t.row !== undefined);

  return thirds.sort((a, b) => {
    const ar = a.row;
    const br = b.row;
    if (ar.points !== br.points) return br.points - ar.points;
    if (ar.goalDifference !== br.goalDifference) return br.goalDifference - ar.goalDifference;
    if (ar.goalsFor !== br.goalsFor) return br.goalsFor - ar.goalsFor;
    return ar.team.rank - br.team.rank;
  });
}

export function getQualifyingThirdGroups(standings: GroupStandings[]): string[] {
  return rankThirdPlaceTeams(standings)
    .slice(0, 8)
    .map((t) => t.groupLetter)
    .sort();
}

export function getQualifyingThirdGroupsKey(standings: GroupStandings[]): string {
  return getQualifyingThirdGroups(standings).join('');
}

export function getTeamAtPosition(
  standings: GroupStandings[],
  groupLetter: string,
  position: number,
): Team | null {
  const group = standings.find((g) => g.groupLetter === groupLetter);
  const row = group?.rows.find((r) => r.position === position);
  return row?.team ?? null;
}
