import { useState } from 'react';
import { useSession } from '../auth/Session';
import { Segmented } from '../components/Segmented';
import { S, t } from '../i18n';
import { formatTime } from '../lib/numbers';
import { ChequesView } from './admin/ChequesView';
import { HistoryView } from './admin/HistoryView';
import { SettingsView } from './admin/SettingsView';
import { StatsView } from './admin/StatsView';

type View = 'stats' | 'history' | 'cheques' | 'settings';
const ALL_VIEWS = ['stats', 'history', 'cheques', 'settings'] as const;
/** A lent window covers the books, never the PINs. */
const TEMPORARY_VIEWS = ['stats', 'history', 'cheques'] as const;

export function AdminScreen() {
  const { session, isTemporaryAdmin } = useSession();
  const [view, setView] = useState<View>('stats');
  if (!session) return null;

  const temporary = isTemporaryAdmin;
  const allowed = temporary ? TEMPORARY_VIEWS : ALL_VIEWS;
  const views = allowed.map((v) => ({ value: v, label: S.admin.views[v] }));
  const current = (allowed as readonly View[]).includes(view) ? view : 'stats';
  const endsAt = temporary ? session.temporaryAdminUntil ?? session.expiresAt : session.expiresAt;

  return (
    <div className="stack">
      <div className="admin-bar">
        <span className="muted small">
          {temporary
            ? t(S.admin.tempBanner, { time: formatTime(endsAt) })
            : t(S.admin.sessionEnds, { time: formatTime(endsAt) })}
        </span>
      </div>
      {temporary && <p className="notice notice--temp">{S.admin.tempHelp}</p>}
      <Segmented label={S.tabs.admin} hideLabel options={views} value={current} onChange={setView} />
      {current === 'stats' && <StatsView />}
      {current === 'history' && <HistoryView />}
      {current === 'cheques' && <ChequesView />}
      {current === 'settings' && <SettingsView />}
    </div>
  );
}
