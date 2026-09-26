import { useRegisterSW } from 'virtual:pwa-register/react';
import { S } from '../i18n';

/** A new version is waiting. The cashier chooses when to reload — never mid-sale. */
export function UpdatePrompt() {
  const {
    needRefresh: [needRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisteredSW(_url, reg) {
      // Check for a new deploy every 30 minutes on long-running counter sessions.
      if (reg) setInterval(() => void reg.update(), 30 * 60 * 1000);
    },
  });

  if (!needRefresh) return null;
  return (
    <div className="update-banner" role="status">
      <span>{S.update.available}</span>
      <button type="button" className="btn btn--sm btn--primary" onClick={() => void updateServiceWorker(true)}>
        {S.update.reload}
      </button>
    </div>
  );
}
