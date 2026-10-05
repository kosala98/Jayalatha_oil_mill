import { RecentEntries } from '../components/RecentEntries';

/**
 * අවසන් ගනුදෙනු: the last five transactions, sales and purchases together, so the
 * counter can check what was just recorded without the admin history.
 */
export function RecentScreen() {
  return (
    <div className="stack form--narrow">
      <RecentEntries />
    </div>
  );
}
