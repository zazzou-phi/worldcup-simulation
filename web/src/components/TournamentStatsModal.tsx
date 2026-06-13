import { useMemo } from 'react';
import type { ConsensusMode } from '../lib/consensusMode.js';
import { formatConsensusMode } from '../lib/consensusMode.js';
import type { Fixture, MasterGroupState, TournamentState } from '../types.js';
import {
  computePoolStats,
  computeTournamentStats,
  computeTournamentStatsFromMatches,
  formatOutcomeSummary,
  formatPoolOutcomeSummary,
  GROUP_GAMES_MATCHDAY_CUTOFF,
  type PoolTournamentStats,
  type RoundGoalStats,
  type TournamentStats,
} from '../lib/tournamentStats.js';

type Source =
  | { kind: 'simulation'; state: TournamentState }
  | {
      kind: 'prediction';
      masterState: MasterGroupState;
      fixtures: Fixture[];
      consensusMode: ConsensusMode;
    };

interface Props {
  source: Source;
  onClose: () => void;
}

function StatCard({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="tournament-stat-card">
      <span className="tournament-stat-label">{label}</span>
      <span className="tournament-stat-value">{value}</span>
      {hint ? <span className="tournament-stat-hint">{hint}</span> : null}
    </div>
  );
}

function RoundTable({
  rounds,
  stage,
  formatResults,
}: {
  rounds: RoundGoalStats[];
  stage: 'group' | 'knockout';
  formatResults: (round: RoundGoalStats) => string;
}) {
  const rows = rounds.filter((round) => round.stage === stage);
  if (rows.length === 0) return null;

  return (
    <div className="tournament-stats-section">
      <h3>{stage === 'group' ? 'Group stage by round' : 'Knockout by round'}</h3>
      <div className="ratings-table-wrap">
        <table className="ratings-table tournament-stats-table">
          <thead>
            <tr>
              <th>Round</th>
              <th>Played</th>
              <th>Goals</th>
              <th>Avg</th>
              <th>Results</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((round) => {
              const outcomeTotal =
                round.outcomes.homeWins + round.outcomes.draws + round.outcomes.awayWins;
              return (
                <tr key={round.key}>
                  <td>{round.label}</td>
                  <td>
                    {round.matchesPlayed}/{round.matchesScheduled}
                  </td>
                  <td>{round.totalGoals.toLocaleString()}</td>
                  <td>
                    {outcomeTotal > 0 ? (round.totalGoals / outcomeTotal).toFixed(2) : '—'}
                  </td>
                  <td className="tournament-stats-outcomes">
                    {outcomeTotal > 0 ? formatResults(round) : '—'}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function TournamentStatsBody({ stats }: { stats: TournamentStats }) {
  const groupMatchesPlayed = stats.rounds
    .filter((round) => round.stage === 'group')
    .reduce((sum, round) => sum + round.matchesPlayed, 0);
  const knockoutMatchesPlayed = stats.rounds
    .filter((round) => round.stage === 'knockout')
    .reduce((sum, round) => sum + round.matchesPlayed, 0);

  if (stats.matchesPlayed === 0) {
    return null;
  }

  return (
    <>
      <div className="tournament-stat-grid">
        <StatCard
          label="Matches played"
          value={`${stats.matchesPlayed}/${stats.matchesScheduled}`}
        />
        <StatCard
          label="Total goals"
          value={stats.totalGoals.toLocaleString()}
          hint={
            stats.avgGoalsPerMatch != null
              ? `${stats.avgGoalsPerMatch.toFixed(2)} per match`
              : undefined
          }
        />
        <StatCard
          label="Group stage"
          value={`${groupMatchesPlayed} match${groupMatchesPlayed === 1 ? '' : 'es'}`}
          hint={formatOutcomeSummary(stats.groupOutcomes)}
        />
        {!stats.groupOnly && (
          <StatCard
            label="Knockout"
            value={`${knockoutMatchesPlayed} match${knockoutMatchesPlayed === 1 ? '' : 'es'}`}
            hint={
              knockoutMatchesPlayed > 0
                ? formatOutcomeSummary(stats.knockoutOutcomes)
                : 'Not started'
            }
          />
        )}
      </div>

      {stats.champion && (
        <p className="tournament-stats-champion">
          Champion: {stats.champion.flag} {stats.champion.teamName}
        </p>
      )}

      <div className="tournament-stats-highlights">
        {stats.highestScoringMatch && (
          <p>
            Highest scoring match:{' '}
            <strong>
              {stats.highestScoringMatch.label} ({stats.highestScoringMatch.scoreline})
            </strong>
          </p>
        )}
        <p>
          Clean sheets: <strong>{stats.cleanSheets}</strong> · Goalless draws:{' '}
          <strong>{stats.goallessDraws}</strong>
        </p>
      </div>

      <RoundTable
        rounds={stats.rounds}
        stage="group"
        formatResults={(round) => formatOutcomeSummary(round.outcomes)}
      />
      {!stats.groupOnly && (
        <RoundTable
          rounds={stats.rounds}
          stage="knockout"
          formatResults={(round) => formatOutcomeSummary(round.outcomes)}
        />
      )}

      {stats.topScorers.length > 0 && (
        <div className="tournament-stats-section">
          <h3>Team records</h3>
          <div className="ratings-table-wrap">
            <table className="ratings-table tournament-stats-table">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Team</th>
                  <th>W</th>
                  <th>D</th>
                  <th>L</th>
                  <th>GF</th>
                  <th>GA</th>
                  <th>GD</th>
                </tr>
              </thead>
              <tbody>
                {stats.topScorers.map((row, index) => (
                  <tr key={row.teamId}>
                    <td>{index + 1}</td>
                    <td>
                      {row.flag} {row.teamName}
                    </td>
                    <td>{row.won}</td>
                    <td>{row.drawn}</td>
                    <td>{row.lost}</td>
                    <td>{row.goalsFor}</td>
                    <td>{row.goalsAgainst}</td>
                    <td>
                      {row.goalDifference >= 0 ? `+${row.goalDifference}` : row.goalDifference}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </>
  );
}

function PoolStatsSection({ pool }: { pool: PoolTournamentStats }) {
  if (pool.matchesWithData === 0) return null;

  const outcomeTotal = pool.outcomes.homeWins + pool.outcomes.draws + pool.outcomes.awayWins;

  return (
    <div className="tournament-stats-pool">
      <h3 className="tournament-stats-pool-title">Simulation pool aggregates</h3>
      <p className="muted tournament-stats-pool-desc">
        Totals across all group-stage results in the prediction selection (
        {pool.simulationSamples.toLocaleString()} simulation
        {pool.simulationSamples === 1 ? '' : 's'} sampled).
      </p>

      <div className="tournament-stat-grid">
        <StatCard
          label="Matches with data"
          value={`${pool.matchesWithData}/${pool.matchesScheduled}`}
        />
        <StatCard
          label="Total goals"
          value={pool.totalGoals.toLocaleString()}
          hint={
            pool.avgGoalsPerMatch != null
              ? `${pool.avgGoalsPerMatch.toFixed(2)} per result`
              : undefined
          }
        />
        <StatCard
          label="Pool outcomes"
          value={`${outcomeTotal.toLocaleString()} results`}
          hint={formatPoolOutcomeSummary(pool.outcomes, outcomeTotal)}
        />
      </div>

      <RoundTable
        rounds={pool.rounds}
        stage="group"
        formatResults={(round) => {
          const total = round.outcomes.homeWins + round.outcomes.draws + round.outcomes.awayWins;
          return formatPoolOutcomeSummary(round.outcomes, total);
        }}
      />
    </div>
  );
}

export function TournamentStatsModal({ source, onClose }: Props) {
  const { title, description, stats, pool } = useMemo(() => {
    if (source.kind === 'simulation') {
      return {
        title: 'Tournament statistics',
        description: (
          <>
            Summary for the current simulation. Group rounds follow the same matchday cutoffs as the
            simulate menu (through matchdays {GROUP_GAMES_MATCHDAY_CUTOFF[1]},{' '}
            {GROUP_GAMES_MATCHDAY_CUTOFF[2]}, and {GROUP_GAMES_MATCHDAY_CUTOFF[3]}).
          </>
        ),
        stats: computeTournamentStats(source.state),
        pool: null,
      };
    }

    const consensusStats = computeTournamentStatsFromMatches(
      source.masterState.resolvedMatches,
      source.fixtures,
      { groupOnly: true },
    );

    return {
      title: 'Prediction statistics',
      description: (
        <>
          Group-stage consensus using <strong>{formatConsensusMode(source.consensusMode)}</strong>{' '}
          mode, plus aggregates across all simulations in the active prediction. Knockout rounds are
          not included in the predictions view.
        </>
      ),
      stats: consensusStats,
      pool: computePoolStats(source.masterState.distributions, source.fixtures),
    };
  }, [source]);

  const empty =
    source.kind === 'simulation'
      ? stats.matchesPlayed === 0
      : stats.matchesPlayed === 0 && (pool?.matchesWithData ?? 0) === 0;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal modal-wide tournament-stats-modal" onClick={(e) => e.stopPropagation()}>
        <h2>{title}</h2>
        <p className="muted tournament-stats-desc">{description}</p>

        {empty ? (
          <p className="muted">
            {source.kind === 'simulation'
              ? 'No matches played yet. Simulate or enter results to see statistics.'
              : 'No group matches played across simulations yet. Run simulations or bulk simulate to build consensus.'}
          </p>
        ) : (
          <>
            {source.kind === 'prediction' && stats.matchesPlayed > 0 && (
              <div className="tournament-stats-section tournament-stats-section-heading">
                <h3>Consensus tournament</h3>
              </div>
            )}
            <TournamentStatsBody stats={stats} />
            {pool && <PoolStatsSection pool={pool} />}
          </>
        )}

        <div className="modal-actions">
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
