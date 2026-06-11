/**
 * Parse Wikipedia Annex C table into data/annex-c.json
 * Source: 2026 FIFA World Cup knockout stage Wikipedia page
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const wikiPath =
  process.env.ANNEX_C_SOURCE ??
  '/Users/zain/.cursor/projects/Users-zain-source-sandbox/agent-tools/365aa547-d880-43fa-866a-934122751895.txt';

const WINNER_SLOTS = ['1A', '1B', '1D', '1E', '1G', '1I', '1K', '1L'];
const MATCH_BY_WINNER = {
  '1A': 79,
  '1B': 85,
  '1D': 81,
  '1E': 74,
  '1G': 82,
  '1I': 77,
  '1K': 87,
  '1L': 80,
};

const ALL_GROUPS = 'ABCDEFGHIJKL'.split('');

function parseTable(text) {
  const lines = text.split('\n');
  const combinations = [];
  let inTable = false;

  for (const line of lines) {
    if (line.includes('| 1 | E | F | G | H | I | J | K | L |')) {
      inTable = true;
    }
    if (!inTable) continue;
    if (!line.startsWith('| ') || line.includes('---')) continue;

    const parts = line
      .split('|')
      .map((p) => p.trim())
      .filter(Boolean);

    const num = parseInt(parts[0], 10);
    if (Number.isNaN(num) || num < 1 || num > 495) continue;

    const slotValues = parts.slice(1, 9);
    if (slotValues.length !== 8) continue;

    const qualifyingThirds = [...slotValues].sort().join('');
    const slotMap = {};
    for (let i = 0; i < WINNER_SLOTS.length; i++) {
      slotMap[MATCH_BY_WINNER[WINNER_SLOTS[i]]] = slotValues[i];
    }

    combinations.push({
      id: num,
      qualifyingThirdGroups: qualifyingThirds,
      thirdByMatch: slotMap,
    });
  }

  return combinations;
}

const text = readFileSync(wikiPath, 'utf8');
const combinations = parseTable(text);

const byKey = Object.fromEntries(
  combinations.map((c) => [c.qualifyingThirdGroups, { id: c.id, thirdByMatch: c.thirdByMatch }]),
);

writeFileSync(
  join(__dirname, '../../data/annex-c.json'),
  JSON.stringify({ combinations, byKey }, null, 2),
);
console.log(`Generated ${combinations.length} Annex C combinations`);
