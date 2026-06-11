import annexData from '../../../data/annex-c.json' with { type: 'json' };
import type { GroupStandings, Fixture, SimulationMatch, Team } from './types.js';
import {
  getQualifyingThirdGroups,
  getQualifyingThirdGroupsKey,
  getTeamAtPosition,
} from './standings.js';

type AnnexEntry = { id: number; thirdByMatch: Record<string, string> };

const annexByKey = annexData.byKey as Record<string, AnnexEntry>;

/** R32 matches that need a third-place team resolved via Annex C */
export const THIRD_PLACE_KNOCKOUT_MATCHES = [74, 77, 79, 80, 81, 82, 85, 87];

export function lookupAnnexC(qualifyingThirdGroups: string): AnnexEntry | null {
  return annexByKey[qualifyingThirdGroups] ?? null;
}

export interface SlotContext {
  standings: GroupStandings[];
  qualifyingThirdGroups: string[];
  annexThirdByMatch: Record<string, string>;
  winnersByMatch: Map<number, number>;
  losersByMatch: Map<number, number>;
}

export function parseSlot(slot: string): {
  kind: 'group' | 'third' | 'winner' | 'loser';
  position?: number;
  group?: string;
  groups?: string[];
  matchNumber?: number;
} {
  const win = slot.match(/^W(\d+)$/);
  if (win) return { kind: 'winner', matchNumber: parseInt(win[1], 10) };

  const lose = slot.match(/^L(\d+)$/);
  if (lose) return { kind: 'loser', matchNumber: parseInt(lose[1], 10) };

  const groupPos = slot.match(/^([123])([A-L])$/);
  if (groupPos) {
    return {
      kind: groupPos[1] === '3' ? 'third' : 'group',
      position: parseInt(groupPos[1], 10),
      group: groupPos[2],
    };
  }

  const thirdMulti = slot.match(/^3([A-L](?:\/[A-L])*)/);
  if (thirdMulti) {
    return { kind: 'third', groups: thirdMulti[1].split('/') };
  }

  const thirdSingle = slot.match(/^3([A-L])$/);
  if (thirdSingle) {
    return { kind: 'third', group: thirdSingle[1] };
  }

  return { kind: 'group' };
}

export function resolveSlot(
  slot: string,
  matchNumber: number,
  ctx: SlotContext,
  teamsById: Map<number, Team>,
): Team | null {
  const parsed = parseSlot(slot);

  if (parsed.kind === 'winner' && parsed.matchNumber) {
    const id = ctx.winnersByMatch.get(parsed.matchNumber);
    return id != null ? teamsById.get(id) ?? null : null;
  }

  if (parsed.kind === 'loser' && parsed.matchNumber) {
    const id = ctx.losersByMatch.get(parsed.matchNumber);
    return id != null ? teamsById.get(id) ?? null : null;
  }

  if (parsed.kind === 'group' && parsed.group && parsed.position) {
    return getTeamAtPosition(ctx.standings, parsed.group, parsed.position);
  }

  if (parsed.kind === 'third') {
    if (THIRD_PLACE_KNOCKOUT_MATCHES.includes(matchNumber)) {
      const groupLetter = ctx.annexThirdByMatch[String(matchNumber)];
      if (groupLetter) {
        return getTeamAtPosition(ctx.standings, groupLetter, 3);
      }
    }
    if (parsed.group) {
      return getTeamAtPosition(ctx.standings, parsed.group, 3);
    }
    if (parsed.groups) {
      for (const g of parsed.groups) {
        if (ctx.qualifyingThirdGroups.includes(g)) {
          const annexGroup = ctx.annexThirdByMatch[String(matchNumber)];
          if (annexGroup === g) {
            return getTeamAtPosition(ctx.standings, g, 3);
          }
        }
      }
    }
  }

  return null;
}

export function buildWinnersLosers(
  fixtures: Fixture[],
  matches: SimulationMatch[],
  teamsById: Map<number, Team>,
  ctx: Omit<SlotContext, 'winnersByMatch' | 'losersByMatch'>,
): { winnersByMatch: Map<number, number>; losersByMatch: Map<number, number> } {
  const winnersByMatch = new Map<number, number>();
  const losersByMatch = new Map<number, number>();
  const matchByNumber = new Map(matches.map((m) => [m.matchNumber, m]));
  const fullCtx = { ...ctx, winnersByMatch, losersByMatch };

  const sorted = [...fixtures].sort((a, b) => a.matchNumber - b.matchNumber);

  for (const f of sorted) {
    const result = matchByNumber.get(f.matchNumber);
    if (!result || result.status !== 'played') continue;

    const home =
      f.teamHomeId != null
        ? teamsById.get(f.teamHomeId) ?? null
        : resolveSlot(f.slotHome, f.matchNumber, fullCtx, teamsById);
    const away =
      f.teamAwayId != null
        ? teamsById.get(f.teamAwayId) ?? null
        : resolveSlot(f.slotAway, f.matchNumber, fullCtx, teamsById);

    if (!home || !away) continue;

    const goalsHome = result.goalsHome!;
    const goalsAway = result.goalsAway!;
    let winnerId: number | null = null;
    if (goalsHome > goalsAway) {
      winnerId = home.id;
    } else if (goalsAway > goalsHome) {
      winnerId = away.id;
    } else {
      winnerId = result.winnerTeamId;
    }
    if (winnerId == null) continue;

    const loserId = winnerId === home.id ? away.id : home.id;
    winnersByMatch.set(f.matchNumber, winnerId);
    losersByMatch.set(f.matchNumber, loserId);
  }

  return { winnersByMatch, losersByMatch };
}

export function resolveMatchTeams(
  fixture: Fixture,
  ctx: SlotContext,
  teamsById: Map<number, Team>,
): { home: Team | null; away: Team | null } {
  const home =
    fixture.teamHomeId != null
      ? teamsById.get(fixture.teamHomeId) ?? null
      : resolveSlot(fixture.slotHome, fixture.matchNumber, ctx, teamsById);
  const away =
    fixture.teamAwayId != null
      ? teamsById.get(fixture.teamAwayId) ?? null
      : resolveSlot(fixture.slotAway, fixture.matchNumber, ctx, teamsById);
  return { home, away };
}

export { computePhase, isGroupStageComplete } from './phase.js';

export function buildSlotContext(
  standings: GroupStandings[],
  fixtures: Fixture[],
  matches: SimulationMatch[],
  teamsById: Map<number, Team>,
  annexCCombinationId: number | null,
): SlotContext {
  const qualifyingThirdGroups = getQualifyingThirdGroups(standings);
  const annex = lookupAnnexC(getQualifyingThirdGroupsKey(standings));
  const annexThirdByMatch = annex?.thirdByMatch ?? {};

  const partial: Omit<SlotContext, 'winnersByMatch' | 'losersByMatch'> = {
    standings,
    qualifyingThirdGroups,
    annexThirdByMatch: Object.fromEntries(
      Object.entries(annexThirdByMatch).map(([k, v]) => [k, v]),
    ),
  };

  const { winnersByMatch, losersByMatch } = buildWinnersLosers(
    fixtures,
    matches,
    teamsById,
    partial,
  );

  return { ...partial, winnersByMatch, losersByMatch };
}

export { getQualifyingThirdGroups, getQualifyingThirdGroupsKey };
