import { useState } from 'react';
import type { Customer } from '../domain/types';
import { S } from '../i18n';
import { api } from '../api/endpoints';
import { describeError } from '../api/errors';
import { uuid } from '../lib/ids';
import { formatMoney } from '../lib/numbers';
import { Dialog } from './Dialog';
import { Field } from './Field';
import { useToast } from './Toast';

interface Props {
  customers: Customer[];
  value: string | null;
  onChange(id: string | null): void;
  onCreated(customer: Customer): void;
  error?: string | null;
  required?: boolean;
}

/**
 * A plain <select> rather than a search box: the mill has tens of daily customers,
 * not thousands, and a native picker is the fastest thing on a phone.
 */
export function CustomerPicker({ customers, value, onChange, onCreated, error, required }: Props) {
  const toast = useToast();
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [nameError, setNameError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const chosen = customers.find((c) => c.id === value) ?? null;

  async function create() {
    if (name.trim().length < 2) {
      setNameError(S.validation.customerName);
      return;
    }
    setBusy(true);
    try {
      const created = await api.createCustomer({
        clientId: uuid(),
        name: name.trim(),
        phone: phone.trim() || null,
        note: null,
      });
      onCreated(created);
      onChange(created.id);
      toast(S.customers.created, 'success');
      setAdding(false);
      setName('');
      setPhone('');
    } catch (err) {
      // A customer needs a server id before a credit sale can point at them.
      setNameError(describeError(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="field">
      <label className="field__label" htmlFor="customer-select">
        {S.common.customer} {required ? '' : S.common.optional}
      </label>
      <div className="picker">
        <select
          id="customer-select"
          className={`select ${error ? 'input--error' : ''}`}
          value={value ?? ''}
          onChange={(e) => onChange(e.target.value || null)}
        >
          <option value="">{S.common.customerPick}</option>
          {customers.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        <button type="button" className="btn btn--secondary btn--sm" onClick={() => setAdding(true)}>
          {S.common.customerNew}
        </button>
      </div>
      {error && <p className="field__error">{error}</p>}
      {chosen && chosen.balance !== '0.00' && (
        <p className="muted small">
          {Number(chosen.balance) > 0 ? S.customers.owesUs : S.customers.weOwe}: {S.common.rs}{' '}
          {formatMoney(Math.abs(Number(chosen.balance)).toFixed(2))}
        </p>
      )}

      <Dialog open={adding} title={S.customers.addTitle} onClose={() => !busy && setAdding(false)}>
        <div>
          <Field label={S.customers.name} value={name} onChange={setName} error={nameError} placeholder={S.customers.namePlaceholder} maxLength={80} />
          <Field label={S.customers.phone} value={phone} onChange={setPhone} inputMode="tel" maxLength={20} />
          <div className="dialog__actions">
            <button type="button" className="btn btn--quiet" onClick={() => setAdding(false)} disabled={busy}>
              {S.common.cancel}
            </button>
            <button type="button" className="btn btn--primary" onClick={() => void create()} disabled={busy}>
              {busy ? S.common.saving : S.common.save}
            </button>
          </div>
        </div>
      </Dialog>
    </div>
  );
}
