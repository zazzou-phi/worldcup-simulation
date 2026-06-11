import { openDatabase, getDefaultDbPath } from './db/client.js';
import { Repository } from './db/repository.js';

function parseArgs(argv: string[]): { simulationId: number; dbPath: string } {
  let simulationId: number | null = null;
  let dbPath = getDefaultDbPath();

  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--db') {
      dbPath = argv[++i] ?? dbPath;
      continue;
    }
    if (simulationId == null) {
      simulationId = parseInt(arg, 10);
    }
  }

  if (simulationId == null || !Number.isInteger(simulationId) || simulationId < 1) {
    console.error('Usage: sync-simulation <simulation_id> [--db path]');
    process.exit(1);
  }

  return { simulationId, dbPath };
}

const { simulationId, dbPath } = parseArgs(process.argv);
const { db } = openDatabase(dbPath);
const repo = new Repository(db);

if (!repo.getSimulation(simulationId)) {
  console.error(`Simulation not found: ${simulationId}`);
  process.exit(1);
}

repo.syncResolvedParticipants(simulationId);
console.log(JSON.stringify({ simulationId, ok: true }));
