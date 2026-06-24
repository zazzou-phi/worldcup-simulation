import { openDatabase, getDefaultDbPath } from './db/client.js';
import { Repository } from './db/repository.js';
import { getDefaultPublicExportDir, writePublicSnapshot } from './export/writePublicSnapshot.js';

function parseArgs(argv: string[]): { outDir: string; dbPath: string } {
  let outDir = getDefaultPublicExportDir();
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

const result = writePublicSnapshot(repo, outDir);
console.log(JSON.stringify(result));
