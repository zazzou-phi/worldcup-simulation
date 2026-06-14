export type AppView = 'predictions' | 'simulations' | 'results';

export const APP_VIEWS: AppView[] = ['predictions', 'simulations', 'results'];

export function getAppViews(publicMode: boolean): AppView[] {
  return publicMode ? APP_VIEWS.filter((view) => view !== 'results') : APP_VIEWS;
}

export const APP_VIEW_LABELS: Record<AppView, string> = {
  predictions: 'Predictions',
  simulations: 'Simulations',
  results: 'Results',
};
