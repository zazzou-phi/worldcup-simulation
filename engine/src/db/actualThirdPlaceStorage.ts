import type { Db } from './client.js';
import * as schema from './schema.js';
import {
  defaultThirdPlaceOrder,
  type ThirdPlaceOrderEntry,
} from '../engine/predictionKnockout.js';
import type { GroupStandings } from '../engine/types.js';

export function readActualThirdPlaceOrder(db: Db): ThirdPlaceOrderEntry[] | null {
  const rows = db.select().from(schema.actualThirdPlaceOrder).all();
  if (rows.length === 0) return null;
  return rows
    .map((row) => ({ groupLetter: row.groupLetter, position: row.position }))
    .sort((a, b) => a.position - b.position);
}

export function writeActualThirdPlaceOrder(db: Db, order: ThirdPlaceOrderEntry[]): void {
  db.delete(schema.actualThirdPlaceOrder).run();
  for (const entry of order) {
    db.insert(schema.actualThirdPlaceOrder)
      .values({
        groupLetter: entry.groupLetter,
        position: entry.position,
      })
      .run();
  }
}

export function clearActualThirdPlaceOrder(db: Db): void {
  db.delete(schema.actualThirdPlaceOrder).run();
}

export function ensureActualThirdPlaceOrder(
  db: Db,
  standings: GroupStandings[],
): ThirdPlaceOrderEntry[] {
  const existing = readActualThirdPlaceOrder(db);
  if (existing) return existing;

  const order = defaultThirdPlaceOrder(standings);
  writeActualThirdPlaceOrder(db, order);
  return order;
}
