import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { openDatabase, getDefaultDbPath } from './db/client.js';
import { Repository } from './db/repository.js';
import { buildPublicSnapshot, snapshotToFiles } from './export/publicSnapshot.js';

function parseArgs(argv: string[]): { outDir: string; dbPath: string } {
  let outDir = join(process.cwd(), '../web/public/data');
  let dbPath = getDefaultDbPath();

  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--out') {
      outDir = argv[++i] ?? outDir;
      continue;
    }
    if (arg === '--db') {
      dbPath = argv[++i] ?? dbPath;
      continue;
    }
  }

  return { outDir, dbPath };
}

const { outDir, dbPath } = parseArgs(process.argv);
const { db } = openDatabase(dbPath);
const repo = new Repository(db);

const snapshot = buildPublicSnapshot(repo);
const files = snapshotToFiles(snapshot);

mkdirSync(outDir, { recursive: true });
for (const [filename, data] of Object.entries(files)) {
  writeFileSync(join(outDir, filename), `${JSON.stringify(data, null, 2)}\n`);
}

console.log(
  JSON.stringify({
    ok: true,
    outDir,
    exportedAt: snapshot.meta.exportedAt,
    predictionId: snapshot.meta.predictionId,
    predictionName: snapshot.meta.predictionName,
  }),
);
