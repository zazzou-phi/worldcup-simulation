import type { Simulation, SimulationMatch } from '../engine/types.js';

export interface SimulationExport {
  version: 1;
  simulation: Omit<Simulation, 'id'> & { sourceId?: number };
  matches: Omit<SimulationMatch, 'simulationId'>[];
}

export function exportSimulation(
  simulation: Simulation,
  matches: SimulationMatch[],
): SimulationExport {
  return {
    version: 1,
    simulation: {
      sourceId: simulation.id,
      name: simulation.name,
      phase: simulation.phase,
      annexCCombinationId: simulation.annexCCombinationId,
      createdAt: simulation.createdAt,
      updatedAt: simulation.updatedAt,
    },
    matches: matches.map(
      ({
        matchNumber,
        teamHomeId,
        teamAwayId,
        goalsHome,
        goalsAway,
        winnerTeamId,
        status,
      }) => ({
        matchNumber,
        teamHomeId,
        teamAwayId,
        goalsHome,
        goalsAway,
        winnerTeamId,
        status,
      }),
    ),
  };
}

export function validateImport(data: unknown): SimulationExport {
  if (!data || typeof data !== 'object') throw new Error('Invalid import file');
  const d = data as SimulationExport;
  if (d.version !== 1) throw new Error('Unsupported export version');
  if (!d.simulation?.name) throw new Error('Missing simulation name');
  if (!Array.isArray(d.matches)) throw new Error('Missing matches');
  return d;
}
