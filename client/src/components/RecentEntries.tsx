import { useCallback, useEffect, useState } from 'react';
import { api } from '../api/endpoints';
import { describePayment } from '../domain/bill';
import { FALLBACK_PRODUCTS } from '../domain/catalog';
import type { Purchase, Sale } from '../domain/types';
import { S } from '../i18n';
import { useLatestGuard, useLiveRefresh } from '../lib/live';
import { formatMoney, formatQty, formatStamp } from '../lib/numbers';

type Named = { customerName?: string | null };
type Entry = { kind: 'sale'; row: Sale & Named } | { kind: 'purchase'; row: Purchase & Named };

const SHOWN = 5;
const productName = (code: string) => FALLBACK_PRODUCTS.find((p) => p.code === code)?.nameSi ?? code;
/** The server sends DATE columns as midnight UTC timestamps; the bill wants the day. */
const day = (d: string | null) => (d ? d.slice(0, 10) : null);

/**
 * The last five transactions of any kind — sales and purchases mixed, newest first —
 * so the counter can check at a glance that what it just entered went through. The five
 * newest overall are always among the five newest of each kind, so both short lists are
 * fetched and merged. Refreshes live; the full history stays admin-only. A transaction
 * still waiting in the offline queue appears once it reaches the server.
 */
export function RecentEntries() {
  const [entries, setEntries] = useState<Entry[] | null>(null);
  const begin = useLatestGuard();

  const load = useCallback(async () => {
    const isCurrent = begin();
    try {
      const [sales, purchases] = await Promise.all([api.recentSales(), api.recentPurchases()]);
      const merged: Entry[] = [
        ...sales.map((row) => ({ kind: 'sale' as const, row })),
        ...purchases.map((row) => ({ kind: 'purchase' as const, row })),
      ]
        .sort((a, b) => b.row.occurredAt.localeCompare(a.row.occurredAt))
        .slice(0, SHOWN);
      if (isCurrent()) setEntries(merged);
    } catch {
      // Offline or signed out: keep showing the last list we had.
    }
  }, [begin]);

  useEffect(() => {
    void load();
  }, [load]);
  useLiveRefresh(['sales', 'purchases', 'customers'], () => void load());

  if (entries === null) return null;

  return (
    <section className="card">
      <h3 className="card__title">{S.recent.title}</h3>
      {entries.length === 0 ? (
        <p className="muted small">{S.recent.empty}</p>
      ) : (
        <ul className="history history--plain">
          {entries.map((e) => {
            const r = e.row;
            const isSale = e.kind === 'sale';
            const title = isSale
              ? e.row.customName ?? productName(e.row.productCode)
              : e.row.customName ?? S.labels.materials[e.row.material];
            const detail = isSale
              ? `${formatQty(e.row.quantity)} ${
                  e.row.unitType === 'BOTTLE' && e.row.bottleSize
                    ? `${S.labels.bottleSizes[e.row.bottleSize]} ${S.labels.units.BOTTLE}`
                    : S.labels.units[e.row.unitType]
                } × ${formatMoney(e.row.pricePerUnit)}`
              : `${formatQty(e.row.quantityKg)} KG × ${formatMoney(e.row.pricePerKg)}`;
            const how = describePayment({ ...r, chequeDepositDate: day(r.chequeDepositDate) }, formatMoney);
            return (
              <li key={`${e.kind}-${r.id}`} className="history__row">
                <div className="history__main">
                  <span className="history__title">
                    {isSale ? S.labels.ledgerKinds.sale : S.labels.ledgerKinds.purchase} · {title}
                  </span>
                  <span className="history__detail">{detail}</span>
                  <span className="history__meta">
                    {formatStamp(r.occurredAt)}
                    {r.customerName ? ` · ${r.customerName}` : ''}
                  </span>
                  {how && <span className="history__meta history__split">{how}</span>}
                </div>
                <div className="history__side">
                  <span className={`history__amount history__amount--${isSale ? 'in' : 'out'}`}>
                    {isSale ? '+ ' : '− '}
                    {formatMoney(r.total)}
                  </span>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
