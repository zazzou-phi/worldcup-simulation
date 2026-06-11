import { teamCode } from '@shared/lib/teamCodes.js';
import type { GroupStandings, StandingRow } from '../types.js';

interface Props {
  standings: GroupStandings[];
  qualifyingThirdGroups: string[];
  selectedTeamId?: number | null;
  onSelectTeam?: (teamId: number) => void;
}

function StandingRowView({
  row,
  qualified,
  selected,
  onSelectTeam,
}: {
  row: StandingRow;
  qualified: boolean;
  selected: boolean;
  onSelectTeam?: (teamId: number) => void;
}) {
  return (
    <tr
      className={[
        qualified ? 'qualified' : '',
        selected ? 'team-selected' : '',
        onSelectTeam ? 'team-selectable' : '',
      ]
        .filter(Boolean)
        .join(' ')}
      onClick={onSelectTeam ? () => onSelectTeam(row.teamId) : undefined}
    >
      <td>{row.position}</td>
      <td title={row.team.name}>
        {row.team.flag} {teamCode(row.team)}
      </td>
      <td>{row.won}</td>
      <td>{row.drawn}</td>
      <td>{row.lost}</td>
      <td>{row.goalsFor}</td>
      <td>{row.goalsAgainst}</td>
      <td>{row.points}</td>
    </tr>
  );
}

function GroupTable({
  group,
  qualifyingThirdGroups,
  selectedTeamId,
  onSelectTeam,
}: {
  group: GroupStandings;
  qualifyingThirdGroups: Set<string>;
  selectedTeamId: number | null;
  onSelectTeam?: (teamId: number) => void;
}) {
  return (
    <div className="group-table">
      <div className="group-table-title">Group {group.groupLetter}</div>
      <table>
        <thead>
          <tr>
            <th>#</th>
            <th>Team</th>
            <th>W</th>
            <th>D</th>
            <th>L</th>
            <th>F</th>
            <th>A</th>
            <th>Pts</th>
          </tr>
        </thead>
        <tbody>
          {group.rows.map((row) => {
            const qualified =
              row.position <= 2 ||
              (row.position === 3 && qualifyingThirdGroups.has(group.groupLetter));
            return (
              <StandingRowView
                key={row.teamId}
                row={row}
                qualified={qualified}
                selected={row.teamId === selectedTeamId}
                onSelectTeam={onSelectTeam}
              />
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export function GroupTables({
  standings,
  qualifyingThirdGroups,
  selectedTeamId = null,
  onSelectTeam,
}: Props) {
  const qualSet = new Set(qualifyingThirdGroups);
  return (
    <div className="group-tables">
      {standings.map((group) => (
        <GroupTable
          key={group.groupLetter}
          group={group}
          qualifyingThirdGroups={qualSet}
          selectedTeamId={selectedTeamId}
          onSelectTeam={onSelectTeam}
        />
      ))}
    </div>
  );
}
