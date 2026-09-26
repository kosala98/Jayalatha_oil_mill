import { type FormEvent, useState } from 'react';
import { Field, NumberField } from '../components/Field';
import { Segmented } from '../components/Segmented';
import type { CashEntryType } from '../domain/types';
import { S } from '../i18n';
import { checkPositive } from '../lib/numbers';
import { useSubmit } from '../lib/useSubmit';

const TYPES = (['OPENING_FLOAT', 'TOP_UP', 'EXPENSE'] as const).map((v) => ({ value: v, label: S.labels.cashTypes[v] }));

export function CashScreen() {
  const [type, setType] = useState<CashEntryType>('OPENING_FLOAT');
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [amountError, setAmountError] = useState<string | null>(null);
  const [noteError, setNoteError] = useState<string | null>(null);
  const isExpense = type === 'EXPENSE';
  const { save, busy, error, clearError } = useSubmit('cash', S.cash.saved);

  async function onSubmit(ev: FormEvent) {
    ev.preventDefault();
    clearError();
    const a = checkPositive(amount, 2);
    if (!a.ok) {
      setAmountError(a.reason === 'decimals' ? S.validation.tooManyDecimals : S.validation.amount);
      return;
    }
    setAmountError(null);
    // An expense without a purpose is an unexplained hole in the drawer.
    if (isExpense && note.trim().length < 3) {
      setNoteError(S.validation.expenseNote);
      return;
    }
    setNoteError(null);
    if (await save({ type, amount: a.value, note: note.trim() || null })) {
      setAmount('');
      setNote('');
      setType('TOP_UP'); // after the morning float, further entries are almost always top-ups
    }
  }

  return (
    <form className="stack" onSubmit={onSubmit} noValidate>
      <section className="card">
        <Segmented label={S.cash.type} options={TYPES} value={type} onChange={setType} />
        <NumberField
          label={S.cash.amount}
          value={amount}
          onChange={setAmount}
          error={amountError}
          prefix={S.common.rs}
          className="field--big"
        />
        <Field
          label={isExpense ? S.cash.expenseNote : S.cash.note}
          placeholder={isExpense ? S.cash.expenseNotePlaceholder : S.cash.notePlaceholder}
          value={note}
          onChange={setNote}
          error={noteError}
          maxLength={200}
        />
        {isExpense && <p className="muted small">{S.cash.expenseHelp}</p>}
      </section>

      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <button type="submit" className="btn btn--primary btn--block btn--lg" disabled={busy}>
        {busy ? S.common.saving : S.cash.submit}
      </button>
    </form>
  );
}
