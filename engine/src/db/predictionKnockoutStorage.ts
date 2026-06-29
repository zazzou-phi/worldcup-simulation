import { and, eq } from 'drizzle-orm';
import type { Db } from './client.js';
import * as schema from './schema.js';
import type {
  KnockoutMatchDistribution,
  PredictionKnockoutResult,
  ThirdPlaceOrderEntry,
} from '../engine/predictionKnockout.js';
import {
  defaultThirdPlaceOrder,
  knockoutMatchNumbersAfterRound,
  knockoutMatchNumbersFromRoundOnward,
} from '../engine/predictionKnockout.js';
import type { GroupStandings } from '../engine/types.js';

export function readPredictionKnockoutResults(
  db: Db,
  predictionId: number,
): PredictionKnockoutResult[] {
  return db
    .select()
    .from(schema.predictionKnockoutResults)
    .where(eq(schema.predictionKnockoutResults.predictionId, predictionId))
    .all()
    .map((row) => ({
      matchNumber: row.matchNumber,
      goalsHome: row.goalsHome,
      goalsAway: row.goalsAway,
      winnerTeamId: row.winnerTeamId,
      penGoalsHome: row.penGoalsHome,
      penGoalsAway: row.penGoalsAway,
      distribution: parseKnockoutDistributionJson(row.distributionJson),
    }));
}

function parseKnockoutDistributionJson(
  value: string | null | undefined,
): KnockoutMatchDistribution | undefined {
  if (!value) return undefined;
  try {
    const parsed = JSON.parse(value) as KnockoutMatchDistribution;
    if (
      typeof parsed.homeWin !== 'number' ||
      typeof parsed.draw !== 'number' ||
      typeof parsed.awayWin !== 'number' ||
      typeof parsed.total !== 'number' ||
      !Array.isArray(parsed.scorelines)
    ) {
      return undefined;
    }
    return parsed;
  } catch {
    return undefined;
  }
}

export function writePredictionKnockoutRound(
  db: Db,
  predictionId: number,
  results: PredictionKnockoutResult[],
): void {
  for (const result of results) {
    db.insert(schema.predictionKnockoutResults)
      .values({
        predictionId,
        matchNumber: result.matchNumber,
        goalsHome: result.goalsHome,
        goalsAway: result.goalsAway,
        winnerTeamId: result.winnerTeamId,
        penGoalsHome: result.penGoalsHome,
        penGoalsAway: result.penGoalsAway,
        distributionJson: result.distribution ? JSON.stringify(result.distribution) : null,
      })
      .onConflictDoUpdate({
        target: [
          schema.predictionKnockoutResults.predictionId,
          schema.predictionKnockoutResults.matchNumber,
        ],
        set: {
          goalsHome: result.goalsHome,
          goalsAway: result.goalsAway,
          winnerTeamId: result.winnerTeamId,
          penGoalsHome: result.penGoalsHome,
          penGoalsAway: result.penGoalsAway,
          distributionJson: result.distribution ? JSON.stringify(result.distribution) : null,
        },
      })
      .run();
  }
}

export function clearPredictionKnockoutResults(db: Db, predictionId: number): void {
  db.delete(schema.predictionKnockoutResults)
    .where(eq(schema.predictionKnockoutResults.predictionId, predictionId))
    .run();
}

export function clearKnockoutResultsFromRoundOnward(
  db: Db,
  predictionId: number,
  roundName: string,
): void {
  const matchNumbers = knockoutMatchNumbersFromRoundOnward(roundName);
  for (const matchNumber of matchNumbers) {
    db.delete(schema.predictionKnockoutResults)
      .where(
        and(
          eq(schema.predictionKnockoutResults.predictionId, predictionId),
          eq(schema.predictionKnockoutResults.matchNumber, matchNumber),
        ),
      )
      .run();
  }
}

export function clearKnockoutResultsAfterRound(
  db: Db,
  predictionId: number,
  roundName: string,
): void {
  for (const matchNumber of knockoutMatchNumbersAfterRound(roundName)) {
    db.delete(schema.predictionKnockoutResults)
      .where(
        and(
          eq(schema.predictionKnockoutResults.predictionId, predictionId),
          eq(schema.predictionKnockoutResults.matchNumber, matchNumber),
        ),
      )
      .run();
  }
}

export function hasPredictionKnockoutResults(db: Db, predictionId: number): boolean {
  const row = db
    .select({ matchNumber: schema.predictionKnockoutResults.matchNumber })
    .from(schema.predictionKnockoutResults)
    .where(eq(schema.predictionKnockoutResults.predictionId, predictionId))
    .limit(1)
    .get();
  return row != null;
}

export function readPredictionThirdPlaceOrder(
  db: Db,
  predictionId: number,
): ThirdPlaceOrderEntry[] | null {
  const rows = db
    .select()
    .from(schema.predictionThirdPlaceOrder)
    .where(eq(schema.predictionThirdPlaceOrder.predictionId, predictionId))
    .all();
  if (rows.length === 0) return null;
  return rows
    .map((row) => ({ groupLetter: row.groupLetter, position: row.position }))
    .sort((a, b) => a.position - b.position);
}

export function writePredictionThirdPlaceOrder(
  db: Db,
  predictionId: number,
  order: ThirdPlaceOrderEntry[],
): void {
  db.delete(schema.predictionThirdPlaceOrder)
    .where(eq(schema.predictionThirdPlaceOrder.predictionId, predictionId))
    .run();

  for (const entry of order) {
    db.insert(schema.predictionThirdPlaceOrder)
      .values({
        predictionId,
        groupLetter: entry.groupLetter,
        position: entry.position,
      })
      .run();
  }
}

export function clearPredictionThirdPlaceOrder(db: Db, predictionId: number): void {
  db.delete(schema.predictionThirdPlaceOrder)
    .where(eq(schema.predictionThirdPlaceOrder.predictionId, predictionId))
    .run();
}

export function ensurePredictionThirdPlaceOrder(
  db: Db,
  predictionId: number,
  standings: GroupStandings[],
): ThirdPlaceOrderEntry[] {
  const existing = readPredictionThirdPlaceOrder(db, predictionId);
  if (existing) return existing;

  const order = defaultThirdPlaceOrder(standings);
  writePredictionThirdPlaceOrder(db, predictionId, order);
  return order;
}

export function resetPredictionThirdPlaceOrder(
  db: Db,
  predictionId: number,
  standings: GroupStandings[],
): ThirdPlaceOrderEntry[] {
  const order = defaultThirdPlaceOrder(standings);
  writePredictionThirdPlaceOrder(db, predictionId, order);
  return order;
}

export function clearPredictionKnockoutState(
  db: Db,
  predictionId: number,
): void {
  clearPredictionKnockoutResults(db, predictionId);
}

export function deletePredictionKnockoutData(db: Db, predictionId: number): void {
  clearPredictionKnockoutResults(db, predictionId);
}

export function readPredictionKnockoutResult(
  db: Db,
  predictionId: number,
  matchNumber: number,
): PredictionKnockoutResult | null {
  const row = db
    .select()
    .from(schema.predictionKnockoutResults)
    .where(
      and(
        eq(schema.predictionKnockoutResults.predictionId, predictionId),
        eq(schema.predictionKnockoutResults.matchNumber, matchNumber),
      ),
    )
    .get();
  if (!row) return null;
  return {
    matchNumber: row.matchNumber,
    goalsHome: row.goalsHome,
    goalsAway: row.goalsAway,
    winnerTeamId: row.winnerTeamId,
    penGoalsHome: row.penGoalsHome,
    penGoalsAway: row.penGoalsAway,
    distribution: parseKnockoutDistributionJson(row.distributionJson),
  };
}
