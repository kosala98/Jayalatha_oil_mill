import { useCallback, useEffect, useState } from 'react';
import { api } from '../api/endpoints';
import { describePayment } from '../domain/bill';
import { FALLBACK_PRODUCTS } from '../domain/catalog';
import type { Purchase, Sale } from '../domain/types';
import { S } from '../i18n';
import { useLatestGuard, useLiveRefresh } from '../lib/live';
import { formatMoney, formatQty, formatStamp } from '../lib/numbers';

type RecentSale = Sale & { customerName?: string | null };
type RecentPurchase = Purchase & { customerName?: string | null };

const productName = (code: string) => FALLBACK_PRODUCTS.find((p) => p.code === code)?.nameSi ?? code;
/** The server sends DATE columns as midnight UTC timestamps; the bill wants the day. */
const day = (d: string | null) => (d ? d.slice(0, 10) : null);

/**
 * The last few sales or purchases, under the form, so the counter can check at a glance
 * that what it just entered went through. Refreshes live; the full history is admin-only.
 * A transaction still waiting in the offline queue appears here once it reaches the server.
 */
export function RecentEntries({ kind }: { kind: 'sale' | 'purchase' }) {
  const [rows, setRows] = useState<(RecentSale | RecentPurchase)[] | null>(null);
  const begin = useLatestGuard();

  const load = useCallback(async () => {
    const isCurrent = begin();
    try {
      const next = kind === 'sale' ? await api.recentSales() : await api.recentPurchases();
      if (isCurrent()) setRows(next);
    } catch {
      // Offline or signed out: keep showing the last list we had.
    }
  }, [kind, begin]);

  useEffect(() => {
    void load();
  }, [load]);
  useLiveRefresh([kind === 'sale' ? 'sales' : 'purchases', 'customers'], () => void load());

  if (rows === null) return null;

  return (
    <section className="card">
      <h3 className="card__title">{kind === 'sale' ? S.recent.sales : S.recent.purchases}</h3>
      {rows.length === 0 ? (
        <p className="muted small">{S.recent.empty}</p>
      ) : (
        <ul className="history history--plain">
          {rows.map((r) => {
            const sale = kind === 'sale' ? (r as RecentSale) : null;
            const purchase = kind === 'purchase' ? (r as RecentPurchase) : null;
            const title = sale
              ? sale.customName ?? productName(sale.productCode)
              : purchase!.customName ?? S.labels.materials[purchase!.material];
            const detail = sale
              ? `${formatQty(sale.quantity)} ${
                  sale.unitType === 'BOTTLE' && sale.bottleSize
                    ? `${S.labels.bottleSizes[sale.bottleSize]} ${S.labels.units.BOTTLE}`
                    : S.labels.units[sale.unitType]
                } × ${formatMoney(sale.pricePerUnit)}`
              : `${formatQty(purchase!.quantityKg)} KG × ${formatMoney(purchase!.pricePerKg)}`;
            const how = describePayment({ ...r, chequeDepositDate: day(r.chequeDepositDate) }, formatMoney);
            return (
              <li key={r.id} className="history__row">
                <div className="history__main">
                  <span className="history__title">{title}</span>
                  <span className="history__detail">{detail}</span>
                  <span className="history__meta">
                    {formatStamp(r.occurredAt)}
                    {r.customerName ? ` · ${r.customerName}` : ''}
                  </span>
                  {how && <span className="history__meta history__split">{how}</span>}
                </div>
                <div className="history__side">
                  <span className={`history__amount history__amount--${sale ? 'in' : 'out'}`}>
                    {sale ? '+ ' : '− '}
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
