import { useState } from 'react';
import { S, t } from '../i18n';
import { formatDateTime, formatMoney, previewTotal } from '../lib/numbers';
import { discard, flush, type OutboxItem, retry } from '../offline/outbox';
import { useOnline, useOutbox } from '../offline/useOutbox';
import { describeError } from '../api/errors';
import { ApiError } from '../api/http';
import { Dialog } from './Dialog';

function itemSummary(item: OutboxItem): string {
  const p = item.payload as Record<string, string>;
  const kind = S.history.types[item.kind];
  const amount =
    item.kind === 'cash'
      ? p.amount
      : item.kind === 'sale'
        ? previewTotal(p.quantity ?? '', p.pricePerUnit ?? '')
        : previewTotal(p.quantityKg ?? '', p.pricePerKg ?? '');
  return `${kind} · ${S.common.rs} ${formatMoney(amount ?? '0')}`;
}

/** Online state + outbox count. Tapping opens the queue so nothing pending is ever invisible. */
export function StatusBar() {
  const online = useOnline();
  const { items, pending, failed } = useOutbox();
  const [open, setOpen] = useState(false);

  const tone = failed.length ? 'failed' : pending.length ? 'pending' : online ? 'online' : 'offline';
  const text = failed.length
    ? t(S.status.failed, { n: failed.length })
    : pending.length
      ? t(S.status.pending, { n: pending.length })
      : online
        ? S.status.online
        : S.status.offline;

  return (
    <>
      <button type="button" className={`status status--${tone}`} onClick={() => setOpen(true)}>
        <span className="status__dot" aria-hidden="true" />
        {text}
      </button>

      <Dialog open={open} title={S.status.sheetTitle} onClose={() => setOpen(false)}>
        {items.length === 0 ? (
          <p className="muted">{S.status.sheetEmpty}</p>
        ) : (
          <>
            <p className="muted small">{S.status.sheetHelp}</p>
            <ul className="outbox-list">
              {items.map((item) => (
                <li key={item.clientId} className={`outbox-item outbox-item--${item.status}`}>
                  <div className="outbox-item__main">
                    <strong>{itemSummary(item)}</strong>
                    <span className="muted small">{formatDateTime(item.payload.occurredAt)}</span>
                  </div>
                  {item.status === 'failed' ? (
                    <>
                      <p className="field__error">
                        {S.status.rejected}:{' '}
                        {describeError(
                          new ApiError(
                            item.lastError?.status ?? 0,
                            item.lastError?.code ?? 'UNKNOWN',
                            item.lastError?.message ?? '',
                            item.lastError?.details,
                          ),
                        )}
                      </p>
                      <div className="row-actions">
                        <button type="button" className="btn btn--secondary btn--sm" onClick={() => void retry(item.clientId)}>
                          {S.status.retry}
                        </button>
                        <button
                          type="button"
                          className="btn btn--danger-quiet btn--sm"
                          onClick={() => {
                            if (window.confirm(S.status.discardConfirm)) void discard(item.clientId);
                          }}
                        >
                          {S.status.discard}
                        </button>
                      </div>
                    </>
                  ) : (
                    <span className="muted small">{S.status.waiting}</span>
                  )}
                </li>
              ))}
            </ul>
          </>
        )}
        <div className="dialog__actions">
          {pending.length > 0 && (
            <button type="button" className="btn btn--secondary" onClick={() => void flush({ force: true })}>
              {S.status.syncNow}
            </button>
          )}
          <button type="button" className="btn btn--primary" onClick={() => setOpen(false)}>
            {S.status.close}
          </button>
        </div>
      </Dialog>
    </>
  );
}
