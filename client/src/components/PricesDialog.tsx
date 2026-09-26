import { type FormEvent, useEffect, useState } from 'react';
import { api } from '../api/endpoints';
import { describeError } from '../api/errors';
import { BOTTLE_SIZES } from '../domain/catalog';
import { CONTAINER_PRICE_IDS, purchasePriceId, salePriceId } from '../domain/prices';
import type { BottleSize, Product, PurchaseMaterial, UnitType } from '../domain/types';
import { S } from '../i18n';
import { checkPositive } from '../lib/numbers';
import { applyPrices, usePrices } from '../lib/usePrices';
import { useProducts } from '../lib/useProducts';
import { Dialog } from './Dialog';
import { NumberField } from './Field';
import { useToast } from './Toast';

const MATERIALS: PurchaseMaterial[] = ['COPRA', 'CHARCOAL', 'OTHER'];

interface Row {
  id: string;
  label: string;
  hint: string;
}

/** Every price the mill sets, in the order someone would read them out. */
function buildRows(products: Product[]): { group: string; rows: Row[] }[] {
  const groups: { group: string; rows: Row[] }[] = [];

  for (const product of products) {
    const rows: Row[] = [];
    for (const unit of product.allowedUnits as UnitType[]) {
      if (unit === 'BOTTLE') {
        for (const size of BOTTLE_SIZES) {
          rows.push({
            id: salePriceId(product.code, 'BOTTLE', size as BottleSize),
            label: S.labels.bottleSizes[size as BottleSize],
            hint: S.prices.perBottle,
          });
        }
      } else {
        rows.push({
          id: salePriceId(product.code, unit),
          label: S.labels.units[unit],
          hint: unit === 'LITER' ? S.prices.perLiter : S.prices.perKg,
        });
      }
    }
    if (rows.length) groups.push({ group: product.nameSi, rows });
  }

  groups.push({
    group: S.prices.containerGroup,
    rows: CONTAINER_PRICE_IDS.map((id) => ({
      id,
      label: id === 'container:CAN' ? S.prices.canLabel : S.labels.bottleSizes[id.split(':')[2] as BottleSize],
      hint: id === 'container:CAN' ? S.sale.containerPriceCan : S.sale.containerPriceBottle,
    })),
  });

  groups.push({
    group: S.prices.purchaseGroup,
    rows: MATERIALS.map((m) => ({ id: purchasePriceId(m), label: S.labels.materials[m], hint: S.prices.perKg })),
  });
  return groups;
}

/**
 * One screen for the day's prices. They stand until someone changes them again —
 * nothing resets overnight — and the sale and purchase forms fill themselves in from here.
 */
export function PricesDialog({ open, onClose }: { open: boolean; onClose(): void }) {
  const products = useProducts();
  const { prices, reload } = usePrices();
  const toast = useToast();
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Start each visit from what is actually stored, not from a stale edit.
  useEffect(() => {
    if (open) {
      setDraft({});
      setError(null);
      void reload();
    }
  }, [open, reload]);

  const groups = buildRows(products);
  const valueOf = (id: string) => draft[id] ?? prices[id] ?? '';

  async function save(e: FormEvent) {
    e.preventDefault();
    const changed = Object.entries(draft)
      .filter(([id, value]) => value.trim() !== '' && value !== (prices[id] ?? ''))
      .map(([id, value]) => ({ id, amount: value.trim() }));

    if (changed.length === 0) {
      onClose();
      return;
    }
    const bad = changed.find((c) => !checkPositive(c.amount, 2).ok);
    if (bad) {
      setError(S.validation.price);
      return;
    }

    setBusy(true);
    setError(null);
    try {
      const result = await api.savePrices(changed);
      applyPrices(Object.fromEntries(result.prices.map((p) => [p.id, String(p.amount)])));
      toast(S.prices.saved, 'success');
      setDraft({});
      onClose();
    } catch (err) {
      setError(describeError(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} title={S.prices.title} onClose={() => !busy && onClose()}>
      <form onSubmit={save} noValidate>
        <p className="muted small">{S.prices.help}</p>
        <div className="prices">
          {groups.map((g) => (
            <section key={g.group} className="prices__group">
              <h4 className="prices__name">{g.group}</h4>
              {g.rows.map((row) => (
                <div key={row.id} className="prices__row">
                  <span className="prices__label">
                    {row.label}
                    <span className="prices__hint">{row.hint}</span>
                  </span>
                  <NumberField
                    label={`${g.group} ${row.label}`}
                    hideLabel
                    value={valueOf(row.id)}
                    onChange={(v) => setDraft((d) => ({ ...d, [row.id]: v }))}
                    prefix={S.common.rs}
                  />
                </div>
              ))}
            </section>
          ))}
        </div>
        {error && <p className="form-error">{error}</p>}
        <div className="dialog__actions">
          <button type="button" className="btn btn--quiet" onClick={onClose} disabled={busy}>
            {S.common.cancel}
          </button>
          <button type="submit" className="btn btn--primary" disabled={busy}>
            {busy ? S.common.saving : S.common.save}
          </button>
        </div>
      </form>
    </Dialog>
  );
}
