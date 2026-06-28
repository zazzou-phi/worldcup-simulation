/**
 * Build data/annex-c.json from the verified FIFA Annex C rows.
 * Source: FIFA World Cup 26 Regulations Annex C (via manganite/wm2026).
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const rowsPath = join(__dirname, '../../data/annex-c-rows.txt');

/** Column order: group winner slot → R32 match number (Article 12.6). */
const WINNER_GROUPS = ['A', 'B', 'D', 'E', 'G', 'I', 'K', 'L'];
const MATCH_BY_WINNER = {
  A: 79,
  B: 85,
  D: 81,
  E: 74,
  G: 82,
  I: 77,
  K: 87,
  L: 80,
};

const rows = readFileSync(rowsPath, 'utf8')
  .split('\n')
  .map((line) => line.trim())
  .filter(Boolean);

if (rows.length !== 495) {
  throw new Error(`Expected 495 Annex C rows, got ${rows.length}`);
}

const combinations = rows.map((row, index) => {
  if (row.length !== 8) {
    throw new Error(`Row ${index + 1} has length ${row.length}, expected 8`);
  }

  const thirdByMatch = {};
  for (let i = 0; i < WINNER_GROUPS.length; i += 1) {
    const winnerGroup = WINNER_GROUPS[i];
    thirdByMatch[String(MATCH_BY_WINNER[winnerGroup])] = row[i];
  }

  const qualifyingThirdGroups = [...row].sort().join('');

  return {
    id: index + 1,
    qualifyingThirdGroups,
    thirdByMatch,
  };
});

const byKey = Object.fromEntries(
  combinations.map((c) => [c.qualifyingThirdGroups, { id: c.id, thirdByMatch: c.thirdByMatch }]),
);

writeFileSync(
  join(__dirname, '../../data/annex-c.json'),
  JSON.stringify({ combinations, byKey }, null, 2),
);
console.log(`Generated ${combinations.length} Annex C combinations`);
