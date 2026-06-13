import { useState, useEffect } from 'react';
import type { ResolvedMatch } from '../types.js';

interface ScoreEditorProps {
  match: ResolvedMatch;
  simulating?: boolean;
  onSave: (goalsHome: number, goalsAway: number, winnerTeamId: number | null) => void;
  onSimulate?: () => void;
  onCancel: () => void;
}

export function ScoreEditor({ match, simulating = false, onSave, onSimulate, onCancel }: ScoreEditorProps) {
  const [home, setHome] = useState(String(match.result.goalsHome ?? 0));
  const [away, setAway] = useState(String(match.result.goalsAway ?? 0));
  const [pickWinner, setPickWinner] = useState(false);
  const isKnockout = match.fixture.group == null;

  useEffect(() => {
    setHome(String(match.result.goalsHome ?? 0));
    setAway(String(match.result.goalsAway ?? 0));
    setPickWinner(false);
  }, [match.fixture.matchNumber]);

  const trySave = () => {
    const gh = parseInt(home, 10) || 0;
    const ga = parseInt(away, 10) || 0;
    if (isKnockout && gh === ga && match.homeTeam && match.awayTeam) {
      setPickWinner(true);
      return;
    }
    const winner =
      gh > ga
        ? (match.homeTeam?.id ?? null)
        : ga > gh
          ? (match.awayTeam?.id ?? null)
          : null;
    onSave(gh, ga, winner);
  };

  if (pickWinner && match.homeTeam && match.awayTeam) {
    return (
      <div className="score-editor winner-pick" onClick={(e) => e.stopPropagation()}>
        <span className="score-label">Winner:</span>
        <button
          type="button"
          className="btn btn-small"
          onClick={() => onSave(parseInt(home, 10) || 0, parseInt(away, 10) || 0, match.homeTeam!.id)}
        >
          {match.homeTeam.flag} Home
        </button>
        <button
          type="button"
          className="btn btn-small"
          onClick={() => onSave(parseInt(home, 10) || 0, parseInt(away, 10) || 0, match.awayTeam!.id)}
        >
          {match.awayTeam.flag} Away
        </button>
        <button type="button" className="btn btn-small btn-ghost" onClick={() => setPickWinner(false)}>
          Back
        </button>
      </div>
    );
  }

  return (
    <div className="score-editor" onClick={(e) => e.stopPropagation()}>
      <input
        type="number"
        min={0}
        max={99}
        value={home}
        onChange={(e) => setHome(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') trySave();
          if (e.key === 'Escape') onCancel();
        }}
        autoFocus
      />
      <span className="score-sep">-</span>
      <input
        type="number"
        min={0}
        max={99}
        value={away}
        onChange={(e) => setAway(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') trySave();
          if (e.key === 'Escape') onCancel();
        }}
      />
      {onSimulate && (
        <button
          type="button"
          className="btn btn-small btn-simulate"
          disabled={simulating}
          onClick={onSimulate}
        >
          Simulate
        </button>
      )}
      <button type="button" className="btn btn-small" onClick={trySave}>
        Save
      </button>
      <button type="button" className="btn btn-small btn-ghost" onClick={onCancel}>
        Cancel
      </button>
    </div>
  );
}

interface ScoreDisplayProps {
  goalsHome: number | null;
  goalsAway: number | null;
  played: boolean;
  pen?: boolean;
  actual?: { goalsHome: number; goalsAway: number };
  hidePredicted?: boolean;
  canSimulate?: boolean;
  simulating?: boolean;
  onClick?: () => void;
  onDoubleClick?: () => void;
}

function predictedSide(goals: number | null, played: boolean): string {
  const value = played && goals != null ? String(goals) : '–';
  return `(${value})`;
}

export function ScoreDisplay({
  goalsHome,
  goalsAway,
  played,
  pen,
  actual,
  hidePredicted = false,
  canSimulate = false,
  simulating = false,
  onClick,
  onDoubleClick,
}: ScoreDisplayProps) {
  if (actual && hidePredicted) {
    return (
      <div className="score-display score-actual-only" title="Actual result">
        {actual.goalsHome} - {actual.goalsAway}
      </div>
    );
  }

  if (actual) {
    const interactive = canSimulate || (played && onClick != null);
    const className = `score-display score-with-actual${interactive ? ' score-interactive' : ''}${
      canSimulate ? ' score-simulatable' : ''
    }`;

    const content = (
      <>
        <span className="score-predicted-home">{predictedSide(goalsHome, played)}</span>
        <span className="score-actual-center" title="Actual result">
          {actual.goalsHome} - {actual.goalsAway}
        </span>
        <span className="score-predicted-away">{predictedSide(goalsAway, played)}</span>
      </>
    );

    if (!interactive) {
      return <div className={className}>{content}</div>;
    }

    return (
      <button
        type="button"
        className={className}
        disabled={simulating}
        title={canSimulate ? 'Click to simulate · double-click to enter manually' : undefined}
        onClick={(e) => {
          e.stopPropagation();
          onClick?.();
        }}
        onDoubleClick={(e) => {
          e.stopPropagation();
          onDoubleClick?.();
        }}
      >
        {content}
      </button>
    );
  }

  if (!played) {
    return (
      <button
        type="button"
        className={`score-display unplayed ${canSimulate ? 'score-simulatable' : ''}`}
        disabled={simulating}
        title={canSimulate ? 'Click to simulate · double-click to enter manually' : undefined}
        onClick={(e) => {
          e.stopPropagation();
          onClick?.();
        }}
        onDoubleClick={(e) => {
          e.stopPropagation();
          onDoubleClick?.();
        }}
      >
        {simulating ? '…' : '- vs -'}
      </button>
    );
  }
  return (
    <button
      type="button"
      className="score-display played"
      onClick={(e) => {
        e.stopPropagation();
        onClick?.();
      }}
    >
      {goalsHome} - {goalsAway}
      {pen ? ' (p)' : ''}
    </button>
  );
}
