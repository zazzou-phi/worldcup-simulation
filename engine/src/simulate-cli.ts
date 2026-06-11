import { openDatabase, getDefaultDbPath } from './db/client.js';
import { Repository } from './db/repository.js';
import { SimulationRunner } from './simulation/runner.js';

type Command = 'group' | 'knockouts';

function parseArgs(argv: string[]): {
  command: Command;
  simulationId: number | undefined;
  dbPath: string;
} {
  let command: Command | null = null;
  let simulationId: number | undefined;
  let dbPath = getDefaultDbPath();

  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--db') {
      dbPath = argv[++i] ?? dbPath;
      continue;
    }
    if (arg === '--simulation-id') {
      const raw = argv[++i];
      simulationId = raw != null ? parseInt(raw, 10) : undefined;
      continue;
    }
    if (arg === 'group' || arg === 'knockouts') {
      command = arg;
      continue;
    }
  }

  if (command == null) {
    console.error('Usage: simulate-cli <group|knockouts> [--simulation-id N] [--db path]');
    process.exit(1);
  }

  if (
    simulationId != null &&
    (!Number.isInteger(simulationId) || simulationId < 1)
  ) {
    console.error('Invalid --simulation-id');
    process.exit(1);
  }

  return { command, simulationId, dbPath };
}

const { command, simulationId, dbPath } = parseArgs(process.argv);
const { db } = openDatabase(dbPath);
const repo = new Repository(db);
const runner = new SimulationRunner(repo);

if (simulationId != null && !repo.getSimulation(simulationId)) {
  console.error(`Simulation not found: ${simulationId}`);
  process.exit(1);
}

try {
  const result =
    command === 'group'
      ? runner.simulateGroupPhase(simulationId)
      : runner.simulateKnockouts(simulationId);
  console.log(JSON.stringify(result));
} catch (err) {
  const message = err instanceof Error ? err.message : String(err);
  console.error(message);
  process.exit(1);
}
