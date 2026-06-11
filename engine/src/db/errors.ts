export class MatchLockedError extends Error {
  constructor(matchNumber: number) {
    super(`Match ${matchNumber} is locked by an actual result`);
    this.name = 'MatchLockedError';
  }
}

export class ActualResultError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ActualResultError';
  }
}
