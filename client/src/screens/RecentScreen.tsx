import { RecentEntries } from '../components/RecentEntries';

/**
 * අවසන් ගනුදෙනු: the last five sales and the last five purchases, so the counter can
 * check what was just recorded without the admin history. Both lists refresh live.
 */
export function RecentScreen() {
  return (
    <div className="stack recent-grid">
      <RecentEntries kind="sale" />
      <RecentEntries kind="purchase" />
    </div>
  );
}
